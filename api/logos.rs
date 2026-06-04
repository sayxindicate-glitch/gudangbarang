use serde_json::{json, Value};
use std::env;
use vercel_runtime::{run, Body, Error, Request, Response, StatusCode};

#[tokio::main]
async fn main() -> Result<(), Error> {
    run(handler).await
}

pub async fn handler(req: Request) -> Result<Response<Body>, Error> {
    // SECURITY PATCH 1: Hanya izinkan metode GET untuk mencegah penyalahgunaan endpoint
    if req.method() != "GET" {
        let error_json = json!({ "error": "Metode tidak diizinkan" });
        return Ok(Response::builder()
            .status(StatusCode::METHOD_NOT_ALLOWED)
            .header("Content-Type", "application/json")
            .body(Body::Text(error_json.to_string()))?);
    }

    let supabase_url = match env::var("SUPABASE_URL") {
        Ok(url) => url,
        Err(_) => return server_error(),
    };
    let supabase_key = match env::var("SUPABASE_ANON_KEY") {
        Ok(key) => key,
        Err(_) => return server_error(),
    };

    let client = reqwest::Client::new();

    // Endpoint REST API Supabase Storage untuk melihat daftar file di dalam bucket 'logos'
    let list_url = format!("{}/storage/v1/object/list/logos", supabase_url);
    
    // Payload untuk request list (standar Supabase Storage API)
    let payload = json!({
        "prefix": "",
        "limit": 100,
        "offset": 0,
        "sortBy": {
            "column": "name",
            "order": "asc"
        }
    });

    let res = client.post(&list_url)
        .header("apikey", &supabase_key)
        .header("Authorization", format!("Bearer {}", supabase_key))
        .header("Content-Type", "application/json")
        .json(&payload)
        .send()
        .await;

    match res {
        Ok(response) if response.status().is_success() => {
            let files: Value = response.json().await.unwrap_or(json!([]));
            let mut logo_urls = Vec::new();

            if let Some(file_array) = files.as_array() {
                for file in file_array {
                    if let Some(name) = file["name"].as_str() {
                        // Membuang file sampah/placeholder
                        if name != ".emptyFolderPlaceholder" {
                            // Merakit URL gambar publik secara manual sesuai standar rute Supabase
                            let public_url = format!("{}/storage/v1/object/public/logos/{}", supabase_url, name);
                            
                            logo_urls.push(json!({
                                "name": name,
                                "url": public_url
                            }));
                        }
                    }
                }
            }

            // PERFORMANCE PATCH: Terapkan sistem Caching persis seperti di .js
            Ok(Response::builder()
                .status(StatusCode::OK)
                .header("Content-Type", "application/json")
                .header("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=86400")
                .body(Body::Text(json!(logo_urls).to_string()))?)
        }
        _ => {
            // SECURITY PATCH 2: Jangan ekspos detail error internal Supabase ke publik
            server_error()
        }
    }
}

fn server_error() -> Result<Response<Body>, Error> {
    let error_json = json!({ "error": "Terjadi kesalahan saat memuat logo." });
    Ok(Response::builder()
        .status(StatusCode::INTERNAL_SERVER_ERROR)
        .header("Content-Type", "application/json")
        .body(Body::Text(error_json.to_string()))?)
}