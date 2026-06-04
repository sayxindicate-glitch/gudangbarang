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
        _ => return error_response(StatusCode::UNAUTHORIZED, "Akses ditolak"),
    };

    let supabase_url = env::var("SUPABASE_URL").unwrap_or_default();
    let supabase_anon = env::var("SUPABASE_ANON_KEY").unwrap_or_default();

    if supabase_url.is_empty() || supabase_anon.is_empty() {
        return error_response(StatusCode::INTERNAL_SERVER_ERROR, "Terjadi kesalahan internal server");
    }

    let client = reqwest::Client::new();

    // 1. Verifikasi Sesi ke Supabase Auth
    let auth_url = format!("{}/auth/v1/user", supabase_url);
    let auth_res = client.get(&auth_url)
        .header("apikey", &supabase_anon)
        .header("Authorization", format!("Bearer {}", token))
        .send().await;

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

    // 2. Ambil data pesanan utama dari gg_orders
    let orders_url = format!("{}/rest/v1/gg_orders?user_id=eq.{}&order=created_at.desc&select=*", supabase_url, user_id);
    let orders_arr = match client.get(&orders_url).header("apikey", &supabase_anon).header("Authorization", format!("Bearer {}", token)).send().await {
        Ok(res) if res.status().is_success() => res.json::<Value>().await.unwrap_or(json!([])).as_array().cloned().unwrap_or_default(),
        _ => return error_response(StatusCode::INTERNAL_SERVER_ERROR, "Gagal memuat pesanan"), // Security Patch terpertahankan
    };

    if orders_arr.is_empty() {
        return no_cache_response(json!([]));
    }

    let order_ids: Vec<String> = orders_arr.iter().filter_map(|o| {
        match &o["id"] {
            Value::Number(n) => Some(n.to_string()),
            Value::String(s) => Some(s.clone()),
            _ => None,
        }
    }).collect();

    // 3. Ambil rincian barang dari gg_order_items
    let items_arr = if !order_ids.is_empty() {
        let items_url = format!("{}/rest/v1/gg_order_items?order_id=in.({})&select=*", supabase_url, order_ids.join(","));
        match client.get(&items_url).header("apikey", &supabase_anon).header("Authorization", format!("Bearer {}", token)).send().await {
            Ok(res) if res.status().is_success() => res.json::<Value>().await.unwrap_or(json!([])).as_array().cloned().unwrap_or_default(),
            _ => return error_response(StatusCode::INTERNAL_SERVER_ERROR, "Gagal memuat rincian pesanan"),
        }
    } else {
        Vec::new()
    };

    // 4. Tarik data dari gg_products berdasarkan product_id
    let mut product_ids = Vec::new();
    for item in &items_arr {
        if let Some(pid) = match &item["product_id"] {
            Value::Number(n) => Some(n.to_string()),
            Value::String(s) => Some(s.clone()),
            _ => None,
        } {
            if !product_ids.contains(&pid) { product_ids.push(pid); }
        }
    }

    let mut products_arr = Vec::new();
    if !product_ids.is_empty() {
        // Hanya memanggil kolom yang diperlukan
        let prods_url = format!("{}/rest/v1/gg_products?id=in.({})&select=id,title,img,price,promo_price", supabase_url, product_ids.join(","));
        if let Ok(res) = client.get(&prods_url).header("apikey", &supabase_anon).header("Authorization", format!("Bearer {}", token)).send().await {
            if res.status().is_success() {
                products_arr = res.json::<Value>().await.unwrap_or(json!([])).as_array().cloned().unwrap_or_default();
            }
        }
    }

    // 5. Jahit / Gabungkan kembali datanya
    let mut final_orders = Vec::new();
    for order in orders_arr {
        let order_id = match &order["id"] {
            Value::Number(n) => n.to_string(),
            Value::String(s) => s.clone(),
            _ => String::new(),
        };

        let mut mapped_items = Vec::new();
        for item in &items_arr {
            let item_order_id = match &item["order_id"] {
                Value::Number(n) => n.to_string(),
                Value::String(s) => s.clone(),
                _ => String::new(),
            };

            if item_order_id == order_id {
                let pid = match &item["product_id"] {
                    Value::Number(n) => n.to_string(),
                    Value::String(s) => s.clone(),
                    _ => String::new(),
                };

                // Pencarian data produk
                let prod = products_arr.iter().find(|p| {
                    match &p["id"] {
                        Value::Number(n) => n.to_string() == pid,
                        Value::String(s) => s == &pid,
                        _ => false,
                    }
                });

                let (title, img, price_str) = if let Some(p) = prod {
                    let t = p["title"].as_str().unwrap_or("Barang Grosir").to_string();
                    let i = p["img"].as_str().unwrap_or("").to_string();
                    let pr = match &p["price"] {
                        Value::Number(n) => n.to_string(),
                        Value::String(s) => s.clone(),
                        _ => "0".to_string(),
                    };
                    (t, i, pr)
                } else {
                    ("Barang Grosir".to_string(), "".to_string(), "0".to_string())
                };

                // Regex Pengganti (Membuang karakter non-angka)
                let fallback_price = price_str.chars().filter(|c| c.is_ascii_digit()).collect::<String>().parse::<i64>().unwrap_or(0);
                
                let price_at_buy = match &item["price_at_buy"] {
                    Value::Number(n) => n.as_i64().unwrap_or(0),
                    Value::String(s) => s.parse::<i64>().unwrap_or(fallback_price),
                    _ => fallback_price,
                };

                let quantity = item["quantity"].as_i64().unwrap_or(1);

                mapped_items.push(json!({
                    "product_name": title,
                    "product_img": img,
                    "product_price": price_at_buy,
                    "quantity": quantity
                }));
            }
        }

        let mut final_order = order.clone();
        if let Some(obj) = final_order.as_object_mut() {
            obj.insert("items".to_string(), json!(mapped_items));
        }
        final_orders.push(final_order);
    }

    no_cache_response(json!(final_orders))
}

// Helper: Response dengan header Anti Nyangkut
fn no_cache_response(payload: Value) -> Result<Response<Body>, Error> {
    Ok(Response::builder()
        .status(StatusCode::OK)
        .header("Content-Type", "application/json")
        .header("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate")
        .header("Pragma", "no-cache")
        .header("Expires", "0")
        .body(Body::Text(payload.to_string()))?)
}

// Helper: Response Error
fn error_response(status: StatusCode, message: &str) -> Result<Response<Body>, Error> {
    let error_json = json!({ "error": message });
    Ok(Response::builder()
        .status(status)
        .header("Content-Type", "application/json")
        .body(Body::Text(error_json.to_string()))?)
}