use chrono::{DateTime, Utc};
use serde_json::{json, Value};
use std::env;
use vercel_runtime::{run, Body, Error, Request, Response, StatusCode};

#[tokio::main]
async fn main() -> Result<(), Error> {
    run(handler).await
}

pub async fn handler(req: Request) -> Result<Response<Body>, Error> {
    if req.method() != "GET" {
        return error_response(StatusCode::METHOD_NOT_ALLOWED, "Metode tidak diizinkan");
    }

    let auth_header = req.headers().get("Authorization").and_then(|h| h.to_str().ok());
    let token = match auth_header {
        Some(h) if h.starts_with("Bearer ") => &h[7..].trim(),
        _ => return error_response(StatusCode::UNAUTHORIZED, "Akses Ditolak"),
    };

    let supabase_url = env::var("SUPABASE_URL").unwrap_or_default();
    let supabase_anon = env::var("SUPABASE_ANON_KEY").unwrap_or_default();

    if supabase_url.is_empty() || supabase_anon.is_empty() {
        return error_response(StatusCode::INTERNAL_SERVER_ERROR, "Terjadi kesalahan internal server");
    }

    let client = reqwest::Client::new();

    // 1. Verifikasi Sesi & Ambil Data Waktu User
    let auth_url = format!("{}/auth/v1/user", supabase_url);
    let auth_res = client.get(&auth_url)
        .header("apikey", &supabase_anon)
        .header("Authorization", format!("Bearer {}", token))
        .send().await;

    let (user_id, created_at, last_sign_in_at) = match auth_res {
        Ok(res) if res.status().is_success() => {
            let user_data: Value = res.json().await.unwrap_or(json!({}));
            let uid = user_data["id"].as_str().unwrap_or("").to_string();
            let created = user_data["created_at"].as_str().unwrap_or("").to_string();
            let last_sign_in = user_data["last_sign_in_at"].as_str().unwrap_or("").to_string();
            
            if uid.is_empty() { return error_response(StatusCode::UNAUTHORIZED, "Sesi login tidak valid"); }
            (uid, created, last_sign_in)
        }
        _ => return error_response(StatusCode::UNAUTHORIZED, "Sesi login tidak valid"),
    };

    let now = Utc::now();

    // Kalkulasi Hari (Fallback ke hari ini jika data tidak terbaca)
    let created_date = DateTime::parse_from_rfc3339(&created_at).unwrap_or_else(|_| now.into()).with_timezone(&Utc);
    let last_sign_in_date = DateTime::parse_from_rfc3339(&last_sign_in_at).unwrap_or_else(|_| now.into()).with_timezone(&Utc);
    
    let days_since_created = (now - created_date).num_days().max(0);
    let days_since_last_sign_in = (now - last_sign_in_date).num_days().max(0);

    // 2. Tarik Riwayat Pesanan (Menghitung Total Transaksi)
    let orders_url = format!("{}/rest/v1/gg_orders?user_id=eq.{}&select=id", supabase_url, user_id);
    let safe_order_count = match client.get(&orders_url).header("apikey", &supabase_anon).header("Authorization", format!("Bearer {}", token)).send().await {
        Ok(res) if res.status().is_success() => {
            res.json::<Value>().await.unwrap_or(json!([])).as_array().map(|arr| arr.len() as i64).unwrap_or(0)
        }
        _ => 0,
    };

    // 3. Tarik Status Klaim Voucher (Terpakai & Dialokasikan)
    let claims_url = format!("{}/rest/v1/gg_claimed_vouchers?user_id=eq.{}&select=voucher_code,is_used", supabase_url, user_id);
    let mut used_codes = Vec::new();
    let mut assigned_codes = Vec::new();
    
    if let Ok(res) = client.get(&claims_url).header("apikey", &supabase_anon).header("Authorization", format!("Bearer {}", token)).send().await {
        if let Ok(claims) = res.json::<Value>().await {
            if let Some(arr) = claims.as_array() {
                for c in arr {
                    let code = c["voucher_code"].as_str().unwrap_or("").to_string();
                    let is_used = c["is_used"].as_bool().unwrap_or(false);
                    if is_used { used_codes.push(code); } else { assigned_codes.push(code); }
                }
            }
        }
    }

    // 4. Tarik Semua Aturan Voucher dari Database
    let vouchers_url = format!("{}/rest/v1/gg_vouchers?select=*", supabase_url);
    let db_vouchers = match client.get(&vouchers_url).header("apikey", &supabase_anon).header("Authorization", format!("Bearer {}", token)).send().await {
        Ok(res) if res.status().is_success() => res.json::<Value>().await.unwrap_or(json!([])).as_array().cloned().unwrap_or_default(),
        _ => return error_response(StatusCode::BAD_REQUEST, "Gagal memuat data voucher"),
    };

    // 5. Eksekusi Mesin Filter Segmentasi (Marketing Logic)
    let mut response_data = Vec::new();
    for v in db_vouchers {
        let segment = v["target_segment"].as_str().unwrap_or("all").trim().to_lowercase();
        let code = v["code"].as_str().unwrap_or("").to_string();

        // Aturan 1: Kedaluwarsa
        if let Some(exp_str) = v["expires_at"].as_str() {
            let parsed_date = DateTime::parse_from_rfc3339(exp_str)
                .or_else(|_| DateTime::parse_from_rfc3339(&format!("{}Z", exp_str)));
            if let Ok(exp) = parsed_date {
                if exp.with_timezone(&Utc) < now { continue; } // Lewati jika sudah kedaluwarsa
            }
        }

        // Aturan 2: Sudah dipakai
        if used_codes.contains(&code) { continue; }

        let mut include = false;

        // Aturan 3 & 4: Alokasi Admin vs Target Rahasia
        if assigned_codes.contains(&code) {
            include = true;
        } else if segment == "targeted" || segment == "private" {
            include = false;
        } 
        // Aturan 5: Segmentasi Otomatis
        else if segment == "all" {
            include = true;
        } else if segment == "new" && safe_order_count == 0 && days_since_created <= 14 {
            include = true;
        } else if segment == "comeback" && safe_order_count > 0 && days_since_last_sign_in > 14 {
            include = true;
        } else if segment == "window_shopper" && safe_order_count == 0 && days_since_last_sign_in <= 7 {
            include = true;
        } else if segment == "loyal" && safe_order_count >= 3 {
            include = true;
        }

        // Merakit JSON jika lolos filter
        if include {
            let id_str = match &v["id"] {
                Value::Number(n) => n.to_string(),
                Value::String(s) => s.clone(),
                _ => String::new(),
            };
            // Fallback ID acak yang aman (Timestamp Nanos) jika tidak ada ID dari DB
            let id = if id_str.is_empty() { now.timestamp_nanos_opt().unwrap_or(0).to_string() } else { id_str };

            response_data.push(json!({
                "id": id,
                "code": code,
                "title": v["title"].as_str().unwrap_or(""),
                "desc": v["description"].as_str().unwrap_or(""),
                "color": v["color"].as_str().unwrap_or("#0984e3"),
                "expires_at": v["expires_at"]
            }));
        }
    }

    Ok(Response::builder()
        .status(StatusCode::OK)
        .header("Content-Type", "application/json")
        .body(Body::Text(json!(response_data).to_string()))?)
}

// Helper: Format Error Terstandarisasi
fn error_response(status: StatusCode, message: &str) -> Result<Response<Body>, Error> {
    let error_json = json!({ "error": message });
    Ok(Response::builder()
        .status(status)
        .header("Content-Type", "application/json")
        .body(Body::Text(error_json.to_string()))?)
}