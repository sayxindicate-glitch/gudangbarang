use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::env;
use vercel_runtime::{run, Body, Error, Request, Response, StatusCode};

#[derive(Debug, Deserialize)]
pub struct AuthPayload {
    pub action: Option<String>,
    pub email: Option<String>,
    pub password: Option<String>,
    pub name: Option<String>,
    pub nickname: Option<String>,
    pub phone: Option<String>,
    pub address: Option<String>,
}

#[tokio::main]
async fn main() -> Result<(), Error> {
    run(handler).await
}

pub async fn handler(req: Request) -> Result<Response<Body>, Error> {
    if req.method() != "POST" {
        return error_response(StatusCode::METHOD_NOT_ALLOWED, "Metode tidak diizinkan");
    }

    // Ambil Environment Variables
    let supabase_url = env::var("SUPABASE_URL").unwrap_or_default();
    let supabase_anon = env::var("SUPABASE_ANON_KEY").unwrap_or_default();
    let supabase_service = env::var("SUPABASE_SERVICE_ROLE_KEY").unwrap_or_default();

    if supabase_url.is_empty() || supabase_anon.is_empty() || supabase_service.is_empty() {
        return error_response(StatusCode::INTERNAL_SERVER_ERROR, "Konfigurasi server bermasalah");
    }

    // Ekstrak Payload
    let payload: AuthPayload = match req.body() {
        Body::Text(t) => serde_json::from_str(t).unwrap_or(AuthPayload { action: None, email: None, password: None, name: None, nickname: None, phone: None, address: None }),
        Body::Binary(b) => serde_json::from_slice(b).unwrap_or(AuthPayload { action: None, email: None, password: None, name: None, nickname: None, phone: None, address: None }),
        Body::Empty => return error_response(StatusCode::BAD_REQUEST, "Payload kosong"),
    };

    let action = payload.action.unwrap_or_default();
    let email = payload.email.unwrap_or_default();
    let password = payload.password.unwrap_or_default();
    
    let client = reqwest::Client::new();

    // --- LOGIKA PENDAFTARAN ---
    if action == "register" {
        let name = payload.name.unwrap_or_default();
        let nickname = payload.nickname.unwrap_or_default();
        let phone = payload.phone.unwrap_or_default();
        let address = payload.address.unwrap_or_default();

        // SECURITY PATCH 1: Validasi Panjang Input
        if email.is_empty() || email.len() > 150 { return error_response(StatusCode::BAD_REQUEST, "Format email tidak valid."); }
        if password.is_empty() || password.len() < 8 || password.len() > 100 { return error_response(StatusCode::BAD_REQUEST, "Format password tidak valid."); }
        if name.len() > 100 { return error_response(StatusCode::BAD_REQUEST, "Nama lengkap terlalu panjang."); }
        if nickname.len() > 50 { return error_response(StatusCode::BAD_REQUEST, "Nama panggilan terlalu panjang."); }
        if phone.len() > 20 { return error_response(StatusCode::BAD_REQUEST, "Nomor WhatsApp terlalu panjang."); }
        if address.len() > 500 { return error_response(StatusCode::BAD_REQUEST, "Alamat terlalu panjang."); }

        // Lapis 1: Deteksi Awal WA Kembar via RPC
        let rpc_url = format!("{}/rest/v1/rpc/check_phone_exists", supabase_url);
        let rpc_res = client.post(&rpc_url)
            .header("apikey", &supabase_anon)
            .header("Authorization", format!("Bearer {}", supabase_anon))
            .json(&json!({ "check_wa": phone }))
            .send().await;

        if let Ok(res) = rpc_res {
            if let Ok(is_taken) = res.json::<bool>().await {
                if is_taken {
                    return error_response(StatusCode::BAD_REQUEST, "Nomor WhatsApp ini sudah terdaftar oleh akun lain.");
                }
            }
        }

        // Mendaftarkan Email & Password ke Auth Inti (GoTrue)
        let signup_url = format!("{}/auth/v1/signup", supabase_url);
        let auth_res = client.post(&signup_url)
            .header("apikey", &supabase_anon)
            .header("Authorization", format!("Bearer {}", supabase_anon))
            .json(&json!({ "email": email, "password": password }))
            .send().await;

        match auth_res {
            Ok(res) if res.status().is_success() => {
                let auth_data: Value = res.json().await.unwrap_or(json!({}));
                let user_id = auth_data["user"]["id"].as_str().unwrap_or(auth_data["id"].as_str().unwrap_or(""));

                if !user_id.is_empty() {
                    // Lapis 2: Mengisi Tabel Profil (Dengan Kunci Master)
                    let profile_url = format!("{}/rest/v1/profiles", supabase_url);
                    let profile_res = client.post(&profile_url)
                        .header("apikey", &supabase_service)
                        .header("Authorization", format!("Bearer {}", supabase_service))
                        .header("Prefer", "resolution=merge-duplicates") // Upsert
                        .json(&json!({
                            "id": user_id,
                            "email": email,
                            "nama_lengkap": name,
                            "nama_panggilan": nickname,
                            "no_wa": phone,
                            "alamat_lengkap": address
                        }))
                        .send().await;

                    // FITUR ROLLBACK JIKA GAGAL
                    if let Ok(p_res) = profile_res {
                        if !p_res.status().is_success() {
                            let err_body = p_res.text().await.unwrap_or_default();
                            
                            // Hancurkan akun dari sistem Auth (Admin Delete)
                            let delete_url = format!("{}/auth/v1/admin/users/{}", supabase_url, user_id);
                            let _ = client.delete(&delete_url)
                                .header("apikey", &supabase_service)
                                .header("Authorization", format!("Bearer {}", supabase_service))
                                .send().await;

                            if err_body.contains("23505") {
                                return error_response(StatusCode::BAD_REQUEST, "Nomor WhatsApp sudah digunakan. Silakan gunakan nomor lain.");
                            }
                            return error_response(StatusCode::BAD_REQUEST, "Gagal menyimpan profil ke dalam sistem.");
                        }
                    }
                }
                return success_response(json!({ "message": "Pendaftaran berhasil", "user": auth_data["user"] }));
            }
            Ok(res) => return parse_supabase_error(res).await,
            Err(_) => return error_response(StatusCode::INTERNAL_SERVER_ERROR, "Terjadi kesalahan sistem internal."),
        }
    } 
    // --- LOGIKA LOGIN ---
    else if action == "login" {
        if email.is_empty() || password.is_empty() {
            return error_response(StatusCode::BAD_REQUEST, "Email dan password wajib diisi.");
        }

        let login_url = format!("{}/auth/v1/token?grant_type=password", supabase_url);
        let auth_res = client.post(&login_url)
            .header("apikey", &supabase_anon)
            .header("Authorization", format!("Bearer {}", supabase_anon))
            .json(&json!({ "email": email, "password": password }))
            .send().await;

        match auth_res {
            Ok(res) if res.status().is_success() => {
                let auth_data: Value = res.json().await.unwrap_or(json!({}));
                let user_id = auth_data["user"]["id"].as_str().unwrap_or("");
                let access_token = auth_data["access_token"].as_str().unwrap_or("");

                // Tarik Profil untuk Display Name
                let profile_url = format!("{}/rest/v1/profiles?id=eq.{}&select=nama_lengkap,nama_panggilan", supabase_url, user_id);
                let mut display_name = email.clone();

                if let Ok(p_res) = client.get(&profile_url).header("apikey", &supabase_anon).header("Authorization", format!("Bearer {}", supabase_anon)).send().await {
                    if let Ok(p_data) = p_res.json::<Value>().await {
                        if let Some(arr) = p_data.as_array() {
                            if let Some(prof) = arr.get(0) {
                                if let Some(np) = prof["nama_panggilan"].as_str().filter(|s| !s.is_empty()) {
                                    display_name = np.to_string();
                                } else if let Some(nl) = prof["nama_lengkap"].as_str().filter(|s| !s.is_empty()) {
                                    display_name = nl.to_string();
                                }
                            }
                        }
                    }
                }

                return success_response(json!({
                    "message": "Login berhasil",
                    "access_token": access_token,
                    "user": auth_data["user"],
                    "name": display_name,
                    "session": auth_data
                }));
            }
            Ok(res) => return parse_supabase_error(res).await,
            Err(_) => return error_response(StatusCode::INTERNAL_SERVER_ERROR, "Terjadi kesalahan sistem internal."),
        }
    } 
    // --- LOGIKA LUPA PASSWORD ---
    else if action == "reset_password" {
        if email.is_empty() { return error_response(StatusCode::BAD_REQUEST, "Email wajib diisi."); }

        let reset_url = format!("{}/auth/v1/recover", supabase_url);
        let reset_res = client.post(&reset_url)
            .header("apikey", &supabase_anon)
            .header("Authorization", format!("Bearer {}", supabase_anon))
            .json(&json!({ "email": email }))
            .send().await;

        match reset_res {
            Ok(res) if res.status().is_success() => {
                return success_response(json!({ "message": "Tautan reset password berhasil dikirim." }));
            }
            Ok(res) => return parse_supabase_error(res).await,
            Err(_) => return error_response(StatusCode::INTERNAL_SERVER_ERROR, "Terjadi kesalahan sistem internal."),
        }
    } else {
        return error_response(StatusCode::BAD_REQUEST, "Aksi tidak dikenali");
    }
}

// Helper untuk format response sukses
fn success_response(payload: Value) -> Result<Response<Body>, Error> {
    Ok(Response::builder().status(StatusCode::OK).header("Content-Type", "application/json").body(Body::Text(payload.to_string()))?)
}

// Helper untuk format response error
fn error_response(status: StatusCode, message: &str) -> Result<Response<Body>, Error> {
    let error_json = json!({ "error": message });
    Ok(Response::builder().status(status).header("Content-Type", "application/json").body(Body::Text(error_json.to_string()))?)
}

// SECURITY PATCH 3: Filter Pesan Error Aman dari Supabase
async fn parse_supabase_error(res: reqwest::Response) -> Result<Response<Body>, Error> {
    let err_body = res.text().await.unwrap_or_default();
    
    if err_body.contains("already registered") {
        return error_response(StatusCode::BAD_REQUEST, "Email ini sudah terdaftar! Silakan ke halaman Login.");
    }
    if err_body.contains("Invalid login credentials") {
        return error_response(StatusCode::BAD_REQUEST, "Email atau Password salah!");
    }
    if err_body.contains("User not found") {
        return error_response(StatusCode::BAD_REQUEST, "Alamat email tidak ditemukan di database kami.");
    }

    // Fallback error umum
    error_response(StatusCode::BAD_REQUEST, "Permintaan tidak dapat diproses saat ini. Silakan coba lagi.")
}