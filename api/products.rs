use serde_json::{json, Value};
use std::env;
use vercel_runtime::{run, Body, Error, Request, Response, StatusCode};

#[tokio::main]
async fn main() -> Result<(), Error> {
    run(handler).await
}

pub async fn handler(req: Request) -> Result<Response<Body>, Error> {
    // SECURITY PATCH 1: Batasi API agar HANYA menerima metode GET
    if req.method() != "GET" {
        let error_json = json!({ "error": "Metode tidak diizinkan" });
        return Ok(Response::builder()
            .status(StatusCode::METHOD_NOT_ALLOWED)
            .header("Content-Type", "application/json")
            .body(Body::Text(error_json.to_string()))?);
    }

    // Mengambil Environment Variables
    let supabase_url = match env::var("SUPABASE_URL") {
        Ok(url) => url,
        Err(_) => return server_error(),
    };
    let supabase_key = match env::var("SUPABASE_ANON_KEY") {
        Ok(key) => key,
        Err(_) => return server_error(),
    };

    // Endpoint REST API Supabase untuk tabel gg_products
    let endpoint = format!("{}/rest/v1/gg_products?select=*&order=id.asc", supabase_url);
    
    let client = reqwest::Client::new();
    let res = client.get(&endpoint)
        .header("apikey", &supabase_key)
        .header("Authorization", format!("Bearer {}", supabase_key))
        .send()
        .await;

    match res {
        Ok(response) if response.status().is_success() => {
            let data: Value = response.json().await.unwrap_or(json!([]));
            
            // PERFORMANCE PATCH: Terapkan sistem Caching persis seperti di .js
            Ok(Response::builder()
                .status(StatusCode::OK)
                .header("Content-Type", "application/json")
                .header("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300")
                .body(Body::Text(data.to_string()))?)
        }
        _ => {
            // SECURITY PATCH 2: Menyamarkan error database
            server_error()
        }
    }
}

// SECURITY PATCH 3: Mencegah Information Disclosure ke peretas
fn server_error() -> Result<Response<Body>, Error> {
    let error_json = json!({ "error": "Terjadi kesalahan sistem saat memuat produk." });
    Ok(Response::builder()
        .status(StatusCode::INTERNAL_SERVER_ERROR)
        .header("Content-Type", "application/json")
        .body(Body::Text(error_json.to_string()))?)
}