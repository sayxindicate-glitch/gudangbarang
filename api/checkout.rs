use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::env;
use vercel_runtime::{run, Body, Error, Request, Response, StatusCode};

// Struktur berlapis untuk menampung payload Checkout
#[derive(Debug, Deserialize)]
pub struct CheckoutItem {
    pub product_id: Value,
    pub quantity: Value,
}

#[derive(Debug, Deserialize)]
pub struct CheckoutPayload {
    pub shipping_address: Option<String>,
    pub phone_number: Option<String>,
    pub items: Option<Vec<CheckoutItem>>,
    pub used_vouchers: Option<Vec<String>>,
}

#[tokio::main]
async fn main() -> Result<(), Error> {
    run(handler).await
}

pub async fn handler(req: Request) -> Result<Response<Body>, Error> {
    if req.method() != "POST" {
        return error_response(StatusCode::METHOD_NOT_ALLOWED, "Metode tidak diizinkan");
    }

    // 1. Ambil & Validasi Token Authorization (Sesi)
    let auth_header = req.headers().get("Authorization").and_then(|h| h.to_str().ok());
    let token = match auth_header {
        Some(h) if h.starts_with("Bearer ") => &h[7..].trim(),
        _ => return error_response(StatusCode::UNAUTHORIZED, "Akses ditolak"),
    };

    let supabase_url = env::var("SUPABASE_URL").unwrap_or_default();
    let supabase_anon = env::var("SUPABASE_ANON_KEY").unwrap_or_default();
    
    if supabase_url.is_empty() || supabase_anon.is_empty() {
        return error_response(StatusCode::INTERNAL_SERVER_ERROR, "Terjadi kesalahan server");
    }

    let client = reqwest::Client::new();

    // 2. Verifikasi Sesi ke Supabase Auth
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

    // 3. Ekstrak Payload
    let payload: CheckoutPayload = match req.body() {
        Body::Text(t) => serde_json::from_str(t).unwrap_or(CheckoutPayload { shipping_address: None, phone_number: None, items: None, used_vouchers: None }),
        Body::Binary(b) => serde_json::from_slice(b).unwrap_or(CheckoutPayload { shipping_address: None, phone_number: None, items: None, used_vouchers: None }),
        Body::Empty => return error_response(StatusCode::BAD_REQUEST, "Data pesanan kosong"),
    };

    let items = match payload.items {
        Some(i) if !i.is_empty() => i,
        _ => return error_response(StatusCode::BAD_REQUEST, "Keranjang kosong"),
    };

    let shipping_address = payload.shipping_address.unwrap_or_default();
    let phone_number = payload.phone_number.unwrap_or_default();
    let full_address = format!("{} (Telp: {})", shipping_address, phone_number);

    // =========================================================================
    // SECURITY 1: MENGHITUNG ULANG HARGA ASLI DARI GUDANG DATABASE
    // =========================================================================
    let mut id_list = Vec::new();
    for item in &items {
        let id_str = match &item.product_id {
            Value::Number(n) => n.to_string(),
            Value::String(s) => s.to_string(),
            _ => continue,
        };
        id_list.push(id_str);
    }
    
    // PostgREST filter: id=in.(1,2,3)
    let in_query = id_list.join(",");
    let prod_url = format!("{}/rest/v1/gg_products?id=in.({})&select=id,price,promo_price,is_promo", supabase_url, in_query);
    
    let prod_res = client.get(&prod_url)
        .header("apikey", &supabase_anon)
        .header("Authorization", format!("Bearer {}", token))
        .send().await;

    let real_products = match prod_res {
        Ok(res) if res.status().is_success() => res.json::<Value>().await.unwrap_or(json!([])),
        _ => return error_response(StatusCode::BAD_REQUEST, "Data barang gagal divalidasi"),
    };

    let mut server_calculated_total = 0.0;
    let mut secure_order_items = Vec::new();

    let real_products_arr = real_products.as_array().cloned().unwrap_or_default();

    for item in &items {
        let req_id = match &item.product_id {
            Value::Number(n) => n.to_string(),
            Value::String(s) => s.to_string(),
            _ => continue,
        };
        
        let qty = match &item.quantity {
            Value::Number(n) => n.as_i64().unwrap_or(1),
            Value::String(s) => s.parse::<i64>().unwrap_or(1),
            _ => 1,
        };

        // Cari produk asli berdasarkan ID
        let real_prod = real_products_arr.iter().find(|p| {
            let p_id = match &p["id"] {
                Value::Number(n) => n.to_string(),
                Value::String(s) => s.to_string(),
                _ => String::new(),
            };
            p_id == req_id
        });

        if let Some(prod) = real_prod {
            let is_promo = prod["is_promo"].as_bool().unwrap_or(false);
            let price = prod["price"].as_f64().unwrap_or(0.0);
            let promo_price = prod["promo_price"].as_f64().unwrap_or(0.0);
            
            let final_item_price = if is_promo && promo_price > 0.0 { promo_price } else { price };
            server_calculated_total += final_item_price * (qty as f64);

            secure_order_items.push(json!({
                "product_id": req_id,
                "quantity": qty,
                "price_at_buy": final_item_price.to_string() // Sesuai dengan skema DB kamu
            }));
        } else {
            return error_response(StatusCode::BAD_REQUEST, &format!("Barang ID {} tidak valid.", req_id));
        }
    }

    // =========================================================================
    // SECURITY 2: VALIDASI VOUCHER & DISKON DI SERVER
    // =========================================================================
    let used_vouchers = payload.used_vouchers.unwrap_or_default();
    
    if !used_vouchers.is_empty() {
        let code = used_vouchers[0].trim().to_uppercase();
        let vch_url = format!("{}/rest/v1/gg_vouchers?code=eq.{}&select=*", supabase_url, code);
        
        if let Ok(res) = client.get(&vch_url).header("apikey", &supabase_anon).header("Authorization", format!("Bearer {}", token)).send().await {
            if let Ok(vch_data) = res.json::<Value>().await {
                if let Some(voucher) = vch_data.as_array().and_then(|arr| arr.get(0)) {
                    
                    let min_purchase = voucher["min_purchase"].as_f64().unwrap_or_else(|| {
                        voucher["min_purchase"].as_str().and_then(|s| s.parse::<f64>().ok()).unwrap_or(0.0)
                    });

                    if server_calculated_total >= min_purchase {
                        let mut discount_amount = 0.0;
                        let d_type = voucher["discount_type"].as_str().unwrap_or("").trim().to_lowercase();
                        let mut d_value = voucher["discount_value"].as_f64().unwrap_or_else(|| {
                            voucher["discount_value"].as_str().and_then(|s| s.parse::<f64>().ok()).unwrap_or(0.0)
                        });

                        if d_type == "percent" || d_type == "persen" {
                            if d_value >= 1.0 && d_value <= 100.0 { d_value /= 100.0; }
                            discount_amount = server_calculated_total * d_value;
                            
                            let max_disc = voucher["max_discount"].as_f64().unwrap_or_else(|| {
                                voucher["max_discount"].as_str().and_then(|s| s.parse::<f64>().ok()).unwrap_or(0.0)
                            });
                            if max_disc > 0.0 && discount_amount > max_disc { discount_amount = max_disc; }
                        } else if d_type == "fixed" || d_type == "nominal" {
                            discount_amount = d_value;
                        }

                        if discount_amount > server_calculated_total { discount_amount = server_calculated_total; }
                        server_calculated_total -= discount_amount;
                    }
                }
            }
        }
    }

    if server_calculated_total < 0.0 { server_calculated_total = 0.0; }

    // =========================================================================
    // 3. EKSEKUSI PENYIMPANAN KE DATABASE (REST POSTGREST)
    // =========================================================================
    
    // Insert Order & dapatkan row kembali (Return Representation)
    let order_url = format!("{}/rest/v1/gg_orders", supabase_url);
    let order_insert_res = client.post(&order_url)
        .header("apikey", &supabase_anon)
        .header("Authorization", format!("Bearer {}", token))
        .header("Prefer", "return=representation")
        .json(&json!([{
            "user_id": user_id,
            "total_price": server_calculated_total as i64,
            "shipping_address": full_address,
            "status": "Diproses"
        }]))
        .send().await;

    let order_id = match order_insert_res {
        Ok(res) if res.status().is_success() => {
            let returned_data: Value = res.json().await.unwrap_or(json!([]));
            match returned_data.as_array().and_then(|arr| arr.get(0)).and_then(|obj| obj["id"].as_i64()) {
                Some(id) => id,
                None => return error_response(StatusCode::INTERNAL_SERVER_ERROR, "Gagal memverifikasi pembuatan pesanan"),
            }
        }
        _ => return error_response(StatusCode::INTERNAL_SERVER_ERROR, "Gagal membuat pesanan"),
    };

    // 4. Masukkan items ke tabel gg_order_items
    let mut items_to_insert = Vec::new();
    for secure_item in secure_order_items {
        let mut new_item = secure_item.clone();
        new_item["order_id"] = json!(order_id);
        items_to_insert.push(new_item);
    }

    let items_url = format!("{}/rest/v1/gg_order_items", supabase_url);
    let _ = client.post(&items_url)
        .header("apikey", &supabase_anon)
        .header("Authorization", format!("Bearer {}", token))
        .json(&items_to_insert)
        .send().await;

    // 5. Kosongkan keranjang belanja
    let clear_cart_url = format!("{}/rest/v1/gg_cart_items?user_id=eq.{}", supabase_url, user_id);
    let _ = client.delete(&clear_cart_url)
        .header("apikey", &supabase_anon)
        .header("Authorization", format!("Bearer {}", token))
        .send().await;

    // 6. Kunci Voucher agar tidak bisa dipakai 2x (Upsert)
    if !used_vouchers.is_empty() {
        let mut claimed_data = Vec::new();
        for code in used_vouchers {
            claimed_data.push(json!({
                "user_id": user_id,
                "voucher_code": code.trim().to_uppercase(),
                "is_used": true
            }));
        }

        let lock_url = format!("{}/rest/v1/gg_claimed_vouchers", supabase_url);
        let _ = client.post(&lock_url)
            .header("apikey", &supabase_anon)
            .header("Authorization", format!("Bearer {}", token))
            .header("Prefer", "resolution=merge-duplicates")
            .json(&claimed_data)
            .send().await;
    }

    // Response Sukses
    let success_json = json!({
        "message": "Pesanan diverifikasi & dibuat",
        "order_id": order_id
    });
    
    Ok(Response::builder()
        .status(StatusCode::OK)
        .header("Content-Type", "application/json")
        .body(Body::Text(success_json.to_string()))?)
}

fn error_response(status: StatusCode, message: &str) -> Result<Response<Body>, Error> {
    let error_json = json!({ "error": message });
    Ok(Response::builder().status(status).header("Content-Type", "application/json").body(Body::Text(error_json.to_string()))?)
}