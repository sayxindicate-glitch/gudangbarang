use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::env;
use vercel_runtime::{run, Body, Error, Request, Response, StatusCode};

// Struktur untuk menangkap payload POST
#[derive(Debug, Deserialize)]
pub struct VoucherRequest {
    pub code: Option<String>,
    pub total_price: Option<Value>,
}

#[tokio::main]
async fn main() -> Result<(), Error> {
    run(handler).await
}

pub async fn handler(req: Request) -> Result<Response<Body>, Error> {
    // 1. Batasi API agar HANYA menerima POST
    if req.method() != "POST" {
        return error_response(StatusCode::METHOD_NOT_ALLOWED, "Metode tidak diizinkan");
    }

    // 2. Ambil & Validasi Token Authorization (Sesi)
    let auth_header = req.headers().get("Authorization").and_then(|h| h.to_str().ok());
    let token = match auth_header {
        Some(h) if h.starts_with("Bearer ") => &h[7..].trim(),
        _ => return error_response(StatusCode::UNAUTHORIZED, "Sesi tidak valid"),
    };

    // 3. Ekstrak Request Body (JSON)
    let payload: VoucherRequest = match req.body() {
        Body::Text(t) => serde_json::from_str(t).unwrap_or(VoucherRequest { code: None, total_price: None }),
        Body::Binary(b) => serde_json::from_slice(b).unwrap_or(VoucherRequest { code: None, total_price: None }),
        Body::Empty => VoucherRequest { code: None, total_price: None },
    };

    let code = payload.code.unwrap_or_default();
    let upper_code = code.trim().to_uppercase();

    // Ekstrak subtotal, toleransi format string/number seperti `parseInt(total_price) || 0`
    let subtotal_val = payload.total_price.unwrap_or(json!(0));
    let subtotal = subtotal_val.as_f64().unwrap_or_else(|| {
        subtotal_val.as_str().and_then(|s| s.parse::<f64>().ok()).unwrap_or(0.0)
    }) as i64;

    // Ambil Environment Variables
    let supabase_url = match env::var("SUPABASE_URL") {
        Ok(url) => url,
        Err(_) => return error_response(StatusCode::INTERNAL_SERVER_ERROR, "Konfigurasi server bermasalah"),
    };
    let supabase_key = match env::var("SUPABASE_ANON_KEY") {
        Ok(key) => key,
        Err(_) => return error_response(StatusCode::INTERNAL_SERVER_ERROR, "Konfigurasi server bermasalah"),
    };

    let client = reqwest::Client::new();

    // 4. Verifikasi User Sesi ke Supabase Auth
    let auth_url = format!("{}/auth/v1/user", supabase_url);
    let auth_res = client.get(&auth_url)
        .header("apikey", &supabase_key)
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await;

    let user_id = match auth_res {
        Ok(res) if res.status().is_success() => {
            let user_data: Value = res.json().await.unwrap_or(json!({}));
            match user_data["id"].as_str() {
                Some(id) => id.to_string(),
                None => return error_response(StatusCode::UNAUTHORIZED, "Sesi tidak valid"),
            }
        }
        _ => return error_response(StatusCode::UNAUTHORIZED, "Sesi tidak valid"),
    };

    // 5. Cek riwayat penggunaan (Mencegah Spam)
    let claim_url = format!(
        "{}/rest/v1/gg_claimed_vouchers?user_id=eq.{}&voucher_code=eq.{}&select=is_used",
        supabase_url, user_id, upper_code
    );
    if let Ok(claim_res) = client.get(&claim_url).header("apikey", &supabase_key).header("Authorization", format!("Bearer {}", token)).send().await {
        if let Ok(claim_data) = claim_res.json::<Value>().await {
            // Jika data berupa array dan ada is_used: true
            if let Some(arr) = claim_data.as_array() {
                if arr.iter().any(|row| row["is_used"].as_bool().unwrap_or(false)) {
                    return error_response(StatusCode::BAD_REQUEST, "Kode voucher ini sudah Anda gunakan sebelumnya.");
                }
            }
        }
    }

    // 6. Tarik Aturan Voucher dari Database
    let voucher_url = format!("{}/rest/v1/gg_vouchers?code=eq.{}&select=*", supabase_url, upper_code);
    let voucher_res = client.get(&voucher_url)
        .header("apikey", &supabase_key)
        .header("Authorization", format!("Bearer {}", supabase_key)) // Membaca data general bisa pakai anon key
        .send()
        .await;

    let voucher = match voucher_res {
        Ok(res) if res.status().is_success() => {
            let data: Value = res.json().await.unwrap_or(json!([]));
            match data.as_array().and_then(|arr| arr.get(0).cloned()) {
                Some(v) => v,
                None => return error_response(StatusCode::BAD_REQUEST, "Kode promo tidak valid atau tidak ditemukan."),
            }
        }
        _ => return error_response(StatusCode::BAD_REQUEST, "Kode promo tidak valid atau tidak ditemukan."),
    };

    // Cek Kadaluarsa
    if let Some(expires_str) = voucher["expires_at"].as_str() {
        // Coba parsing format ISO-8601 UTC
        let parsed_date = DateTime::parse_from_rfc3339(expires_str)
            .or_else(|_| DateTime::parse_from_rfc3339(&format!("{}Z", expires_str)));
        
        if let Ok(expires_at) = parsed_date {
            if expires_at.with_timezone(&Utc) < Utc::now() {
                return error_response(StatusCode::BAD_REQUEST, "Maaf, kode promo ini sudah kadaluarsa.");
            }
        }
    }

    // Cek Syarat Minimal Belanja
    let min_purchase = voucher["min_purchase"].as_f64().unwrap_or_else(|| {
        voucher["min_purchase"].as_str().and_then(|s| s.parse::<f64>().ok()).unwrap_or(0.0)
    }) as i64;

    if subtotal < min_purchase {
        let msg = format!("Minimal belanja Rp {} untuk pakai kode ini.", min_purchase);
        return error_response(StatusCode::BAD_REQUEST, &msg);
    }

    // 7. Eksekusi Rumus Perhitungan Diskon (TANGGUH & ANTI-GAGAL - Rust Version)
    let mut discount_amount = 0.0;
    
    let d_type = voucher["discount_type"].as_str().unwrap_or("").trim().to_lowercase();
    let mut d_value = voucher["discount_value"].as_f64().unwrap_or_else(|| {
        voucher["discount_value"].as_str().and_then(|s| s.parse::<f64>().ok()).unwrap_or(0.0)
    });

    if d_type == "percent" || d_type == "persen" {
        // Konversi pintar: 50 -> 0.5
        if d_value >= 1.0 && d_value <= 100.0 {
            d_value /= 100.0;
        }
        
        discount_amount = (subtotal as f64) * d_value;
        
        let max_disc = voucher["max_discount"].as_f64().unwrap_or_else(|| {
            voucher["max_discount"].as_str().and_then(|s| s.parse::<f64>().ok()).unwrap_or(0.0)
        });

        if max_disc > 0.0 && discount_amount > max_disc {
            discount_amount = max_disc;
        }
    } else if d_type == "fixed" || d_type == "nominal" {
        discount_amount = d_value;
    }

    // Keamanan tambahan: Diskon tidak boleh melebihi total belanja
    let mut final_discount = discount_amount as i64;
    if final_discount > subtotal {
        final_discount = subtotal;
    }
    
    let final_total = subtotal - final_discount;

    // 8. Berikan Response Berhasil
    let success_response = json!({
        "message": "Promo berhasil divalidasi!",
        "discount_amount": final_discount,
        "final_total": final_total
    });

    Ok(Response::builder()
        .status(StatusCode::OK)
        .header("Content-Type", "application/json")
        .body(Body::Text(success_response.to_string()))?)
}

// Helper untuk merapikan respons error
fn error_response(status: StatusCode, message: &str) -> Result<Response<Body>, Error> {
    let error_json = json!({ "error": message });
    Ok(Response::builder()
        .status(status)
        .header("Content-Type", "application/json")
        .body(Body::Text(error_json.to_string()))?)
}