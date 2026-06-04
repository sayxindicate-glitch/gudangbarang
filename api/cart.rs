use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::env;
use vercel_runtime::{run, Body, Error, Request, Response, StatusCode};

#[derive(Debug, Deserialize)]
pub struct CartPayload {
    pub product_id: Option<Value>, // Menggunakan Value agar bisa menangani angka atau string dengan aman
    pub quantity: Option<Value>,
    pub id: Option<Value>,
}

#[tokio::main]
async fn main() -> Result<(), Error> {
    run(handler).await
}

pub async fn handler(req: Request) -> Result<Response<Body>, Error> {
    let method = req.method().as_str();
    if method != "GET" && method != "POST" && method != "DELETE" {
        return error_response(StatusCode::METHOD_NOT_ALLOWED, "Metode tidak diizinkan");
    }

    // 1. Ambil & Validasi Token Authorization (Sesi)
    let auth_header = req.headers().get("Authorization").and_then(|h| h.to_str().ok());
    let token = match auth_header {
        Some(h) if h.starts_with("Bearer ") => &h[7..].trim(),
        _ => return error_response(StatusCode::UNAUTHORIZED, "Tidak ada akses"),
    };

    let supabase_url = env::var("SUPABASE_URL").unwrap_or_default();
    let supabase_anon = env::var("SUPABASE_ANON_KEY").unwrap_or_default();
    
    if supabase_url.is_empty() || supabase_anon.is_empty() {
        return error_response(StatusCode::INTERNAL_SERVER_ERROR, "Terjadi kesalahan sistem");
    }

    let client = reqwest::Client::new();

    // 2. Verifikasi User Sesi ke Supabase Auth
    let auth_url = format!("{}/auth/v1/user", supabase_url);
    let auth_res = client.get(&auth_url)
        .header("apikey", &supabase_anon)
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

    // Ekstrak Body JSON (Khusus POST dan DELETE)
    let payload: CartPayload = if method == "POST" || method == "DELETE" {
        match req.body() {
            Body::Text(t) => serde_json::from_str(t).unwrap_or(CartPayload { product_id: None, quantity: None, id: None }),
            Body::Binary(b) => serde_json::from_slice(b).unwrap_or(CartPayload { product_id: None, quantity: None, id: None }),
            Body::Empty => CartPayload { product_id: None, quantity: None, id: None },
        }
    } else {
        CartPayload { product_id: None, quantity: None, id: None }
    };

    // --- GET: MENGAMBIL DATA KERANJANG ---
    if method == "GET" {
        let url = format!("{}/rest/v1/gg_cart_items?user_id=eq.{}&select=*", supabase_url, user_id);
        match client.get(&url).header("apikey", &supabase_anon).header("Authorization", format!("Bearer {}", token)).send().await {
            Ok(res) if res.status().is_success() => {
                let data: Value = res.json().await.unwrap_or(json!([]));
                return success_response(data);
            }
            _ => return error_response(StatusCode::BAD_REQUEST, "Gagal memuat data keranjang"),
        }
    } 
    // --- POST: MENAMBAH BARANG KE KERANJANG ---
    else if method == "POST" {
        let product_id_str = match &payload.product_id {
            Some(Value::Number(n)) => n.to_string(),
            Some(Value::String(s)) if !s.is_empty() => s.to_string(),
            _ => return error_response(StatusCode::BAD_REQUEST, "ID Produk wajib diisi"),
        };

        let safe_quantity = match &payload.quantity {
            Some(Value::Number(n)) => n.as_i64().unwrap_or(1),
            Some(Value::String(s)) => s.parse::<i64>().unwrap_or(1),
            _ => 1,
        };

        if safe_quantity <= 0 {
            return error_response(StatusCode::BAD_REQUEST, "Kuantitas barang tidak valid (harus angka lebih dari 0)");
        }

        // Ambil data produk ASLI dari database
        let prod_url = format!("{}/rest/v1/gg_products?id=eq.{}&select=title,img,price,promo_price,is_promo", supabase_url, product_id_str);
        let real_product = match client.get(&prod_url).header("apikey", &supabase_anon).header("Authorization", format!("Bearer {}", token)).send().await {
            Ok(res) if res.status().is_success() => {
                let data: Value = res.json().await.unwrap_or(json!([]));
                match data.as_array().and_then(|arr| arr.get(0).cloned()) {
                    Some(p) => p,
                    None => return error_response(StatusCode::BAD_REQUEST, "Produk tidak ditemukan atau tidak valid"),
                }
            }
            _ => return error_response(StatusCode::BAD_REQUEST, "Produk tidak ditemukan atau tidak valid"),
        };

        let is_promo = real_product["is_promo"].as_bool().unwrap_or(false);
        let price = real_product["price"].as_f64().unwrap_or(0.0);
        let promo_price = real_product["promo_price"].as_f64().unwrap_or(0.0);
        let secure_price = if is_promo && promo_price > 0.0 { promo_price } else { price };

        // Cek apakah barang sudah ada di keranjang
        let check_url = format!("{}/rest/v1/gg_cart_items?user_id=eq.{}&product_id=eq.{}&select=*", supabase_url, user_id, product_id_str);
        let existing_item = if let Ok(res) = client.get(&check_url).header("apikey", &supabase_anon).header("Authorization", format!("Bearer {}", token)).send().await {
            res.json::<Value>().await.ok().and_then(|data| data.as_array().and_then(|arr| arr.get(0).cloned()))
        } else {
            None
        };

        if let Some(existing) = existing_item {
            let current_qty = existing["quantity"].as_i64().unwrap_or(0);
            let new_total_qty = current_qty + safe_quantity;

            if new_total_qty > 1000 {
                return error_response(StatusCode::BAD_REQUEST, "Kouta maksimal per barang tercapai");
            }

            let item_id = existing["id"].as_i64().unwrap_or(0);
            let update_url = format!("{}/rest/v1/gg_cart_items?id=eq.{}", supabase_url, item_id);
            let update_res = client.patch(&update_url)
                .header("apikey", &supabase_anon)
                .header("Authorization", format!("Bearer {}", token))
                .json(&json!({ "quantity": new_total_qty }))
                .send().await;

            if update_res.is_err() || !update_res.unwrap().status().is_success() {
                return error_response(StatusCode::BAD_REQUEST, "Gagal memperbarui jumlah barang");
            }
        } else {
            // Barang baru, Insert
            let insert_url = format!("{}/rest/v1/gg_cart_items", supabase_url);
            let insert_res = client.post(&insert_url)
                .header("apikey", &supabase_anon)
                .header("Authorization", format!("Bearer {}", token))
                .json(&json!({
                    "user_id": user_id,
                    "product_id": product_id_str,
                    "product_name": real_product["title"],
                    "product_price": secure_price,
                    "product_img": real_product["img"],
                    "quantity": safe_quantity
                }))
                .send().await;

            if insert_res.is_err() || !insert_res.unwrap().status().is_success() {
                return error_response(StatusCode::BAD_REQUEST, "Gagal memasukkan barang ke keranjang");
            }
        }
        return success_response(json!({ "message": "Berhasil masuk keranjang, tervalidasi server" }));
    }
    // --- DELETE: MENGHAPUS BARANG DARI KERANJANG ---
    else if method == "DELETE" {
        let item_id_str = match &payload.id {
            Some(Value::Number(n)) => n.to_string(),
            Some(Value::String(s)) if !s.is_empty() => s.to_string(),
            _ => return error_response(StatusCode::BAD_REQUEST, "ID Barang tidak valid"),
        };

        let del_url = format!("{}/rest/v1/gg_cart_items?id=eq.{}&user_id=eq.{}", supabase_url, item_id_str, user_id);
        let del_res = client.delete(&del_url)
            .header("apikey", &supabase_anon)
            .header("Authorization", format!("Bearer {}", token))
            .send().await;

        if del_res.is_err() || !del_res.unwrap().status().is_success() {
            return error_response(StatusCode::BAD_REQUEST, "Gagal menghapus barang");
        }
        return success_response(json!({ "message": "Barang dihapus" }));
    }

    error_response(StatusCode::BAD_REQUEST, "Terjadi kesalahan sistem")
}

fn success_response(payload: Value) -> Result<Response<Body>, Error> {
    Ok(Response::builder().status(StatusCode::OK).header("Content-Type", "application/json").body(Body::Text(payload.to_string()))?)
}

fn error_response(status: StatusCode, message: &str) -> Result<Response<Body>, Error> {
    let error_json = json!({ "error": message });
    Ok(Response::builder().status(status).header("Content-Type", "application/json").body(Body::Text(error_json.to_string()))?)
}