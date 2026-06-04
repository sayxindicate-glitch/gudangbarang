use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::env;
use vercel_runtime::{run, Body, Error, Request, Response, StatusCode};

#[derive(Debug, Deserialize)]
pub struct ProfileUpdate {
    pub nama_lengkap: Option<String>,
    pub nama_panggilan: Option<String>,
    pub no_wa: Option<String>,
    pub alamat_lengkap: Option<String>,
}

#[tokio::main]
async fn main() -> Result<(), Error> {
    run(handler).await
}

pub async fn handler(req: Request) -> Result<Response<Body>, Error> {
    let method = req.method().as_str();
    if method != "GET" && method != "PUT" {
        return error_response(StatusCode::METHOD_NOT_ALLOWED, "Metode tidak diizinkan");
    }

    let auth_header = req.headers().get("Authorization").and_then(|h| h.to_str().ok());
    let token = match auth_header {
        Some(h) if h.starts_with("Bearer ") => &h[7..].trim(),
        _ => return error_response(StatusCode::UNAUTHORIZED, "Akses ditolak: Token hilang"),
    };

    let supabase_url = env::var("SUPABASE_URL").unwrap_or_default();
    let supabase_anon = env::var("SUPABASE_ANON_KEY").unwrap_or_default();

    if supabase_url.is_empty() || supabase_anon.is_empty() {
        return error_response(StatusCode::INTERNAL_SERVER_ERROR, "Terjadi kesalahan internal server");
    }

    let client = reqwest::Client::new();

    // Validasi Token & Ambil Data Auth
    let auth_url = format!("{}/auth/v1/user", supabase_url);
    let auth_res = client.get(&auth_url)
        .header("apikey", &supabase_anon)
        .header("Authorization", format!("Bearer {}", token))
        .send().await;

    let (user_id, user_email) = match auth_res {
        Ok(res) if res.status().is_success() => {
            let user_data: Value = res.json().await.unwrap_or(json!({}));
            let uid = user_data["id"].as_str().unwrap_or("").to_string();
            let email = user_data["email"].as_str().unwrap_or("").to_string();
            
            if uid.is_empty() {
                return error_response(StatusCode::UNAUTHORIZED, "Sesi tidak valid");
            }
            (uid, email)
        }
        _ => return error_response(StatusCode::UNAUTHORIZED, "Sesi tidak valid"),
    };

    // --- JIKA REQUEST GET (AMBIL DATA PROFIL) ---
    if method == "GET" {
        let profile_url = format!("{}/rest/v1/profiles?id=eq.{}&select=*", supabase_url, user_id);
        match client.get(&profile_url).header("apikey", &supabase_anon).header("Authorization", format!("Bearer {}", token)).send().await {
            Ok(res) => {
                if !res.status().is_success() {
                    let err_text = res.text().await.unwrap_or_default();
                    // SECURITY PATCH: Menyamarkan pesan error database (PGRST116 = Not Found)
                    if !err_text.contains("PGRST116") {
                        return error_response(StatusCode::INTERNAL_SERVER_ERROR, "Gagal memuat profil");
                    }
                } else {
                    let data: Value = res.json().await.unwrap_or(json!([]));
                    if let Some(arr) = data.as_array() {
                        if !arr.is_empty() {
                            return success_response(arr[0].clone());
                        }
                    }
                }
            }
            Err(_) => return error_response(StatusCode::INTERNAL_SERVER_ERROR, "Gagal memuat profil"),
        }
        // Jika profil tidak ditemukan, kembalikan email saja sesuai logika awal
        return success_response(json!({ "email": user_email }));
    }

    // --- JIKA REQUEST PUT (SIMPAN PERUBAHAN PROFIL) ---
    if method == "PUT" {
        let payload: ProfileUpdate = match req.body() {
            Body::Text(t) => serde_json::from_str(t).unwrap_or(ProfileUpdate { nama_lengkap: None, nama_panggilan: None, no_wa: None, alamat_lengkap: None }),
            Body::Binary(b) => serde_json::from_slice(b).unwrap_or(ProfileUpdate { nama_lengkap: None, nama_panggilan: None, no_wa: None, alamat_lengkap: None }),
            Body::Empty => return error_response(StatusCode::BAD_REQUEST, "Payload kosong"),
        };

        let nama_lengkap = payload.nama_lengkap.unwrap_or_default();
        let nama_panggilan = payload.nama_panggilan.unwrap_or_default();
        let no_wa = payload.no_wa.unwrap_or_default();
        let alamat_lengkap = payload.alamat_lengkap.unwrap_or_default();

        // SECURITY PATCH: Batasi panjang input (Mencegah Database Overload / DoS)
        if nama_lengkap.len() > 100 { return error_response(StatusCode::BAD_REQUEST, "Nama terlalu panjang"); }
        if nama_panggilan.len() > 50 { return error_response(StatusCode::BAD_REQUEST, "Panggilan terlalu panjang"); }
        if no_wa.len() > 20 { return error_response(StatusCode::BAD_REQUEST, "Nomor WA tidak valid"); }
        if alamat_lengkap.len() > 500 { return error_response(StatusCode::BAD_REQUEST, "Alamat terlalu panjang"); }

        let current_time = Utc::now().to_rfc3339(); // Format ISO-8601 UTC

        let upsert_url = format!("{}/rest/v1/profiles", supabase_url);
        let upsert_res = client.post(&upsert_url)
            .header("apikey", &supabase_anon)
            .header("Authorization", format!("Bearer {}", token))
            .header("Prefer", "resolution=merge-duplicates,return=representation")
            .json(&json!({
                "id": user_id,
                "email": user_email,
                "nama_lengkap": nama_lengkap,
                "nama_panggilan": nama_panggilan,
                "no_wa": no_wa,
                "alamat_lengkap": alamat_lengkap,
                "created_at": current_time
            }))
            .send().await;

        match upsert_res {
            Ok(res) if res.status().is_success() => {
                let data: Value = res.json().await.unwrap_or(json!([]));
                let profile = if let Some(arr) = data.as_array() {
                    arr.get(0).cloned().unwrap_or(json!({}))
                } else {
                    data
                };
                return success_response(json!({ "message": "Profil berhasil diperbarui", "profile": profile }));
            }
            Ok(res) => {
                let err_text = res.text().await.unwrap_or_default();
                if err_text.contains("23505") {
                    return error_response(StatusCode::BAD_REQUEST, "Nomor WhatsApp sudah digunakan oleh akun lain.");
                }
                // SECURITY PATCH: Menyamarkan pesan error jika gagal simpan
                return error_response(StatusCode::INTERNAL_SERVER_ERROR, "Gagal memperbarui profil di server");
            }
            Err(_) => return error_response(StatusCode::INTERNAL_SERVER_ERROR, "Gagal memperbarui profil di server"),
        }
    }

    error_response(StatusCode::METHOD_NOT_ALLOWED, "Metode tidak diizinkan")
}

// Helper: Format Sukses
fn success_response(payload: Value) -> Result<Response<Body>, Error> {
    Ok(Response::builder().status(StatusCode::OK).header("Content-Type", "application/json").body(Body::Text(payload.to_string()))?)
}

// Helper: Format Error
fn error_response(status: StatusCode, message: &str) -> Result<Response<Body>, Error> {
    let error_json = json!({ "error": message });
    Ok(Response::builder().status(status).header("Content-Type", "application/json").body(Body::Text(error_json.to_string()))?)
}