import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'Tidak ada akses' });
    const token = authHeader.split(' ')[1];

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: `Bearer ${token}` } }
    });

    try {
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) throw new Error('Sesi tidak valid');

        // GET: MENGAMBIL DATA KERANJANG
        if (req.method === 'GET') {
            const { data, error } = await supabase.from('gg_cart_items').select('*').eq('user_id', user.id);
            if (error) throw new Error('Gagal memuat data keranjang');
            return res.status(200).json(data);
        } 
        // POST: MENAMBAH BARANG KE KERANJANG (SECURITY PATCHED)
        else if (req.method === 'POST') {
            const { product_id, quantity } = req.body;
            
            // SECURITY PATCH 1: Mencegah Kuantitas Minus (Integer Underflow) & Injeksi Teks
            if (!product_id) return res.status(400).json({ error: 'ID Produk wajib diisi' });
            
            const safeQuantity = quantity !== undefined ? parseInt(quantity) : 1;
            if (isNaN(safeQuantity) || safeQuantity <= 0) {
                return res.status(400).json({ error: 'Kuantitas barang tidak valid (harus angka lebih dari 0)' });
            }
            
            // SECURITY: Tarik nama, gambar, dan harga LANGSUNG dari tabel asli
            const { data: realProduct, error: prodError } = await supabase.from('gg_products')
                .select('title, img, price, promo_price, is_promo')
                .eq('id', product_id).single();
                
            if (prodError || !realProduct) throw new Error('Produk tidak ditemukan atau tidak valid');

            const securePrice = (realProduct.is_promo && realProduct.promo_price) ? realProduct.promo_price : realProduct.price;
            
            const { data: existing } = await supabase.from('gg_cart_items')
                .select('*').eq('user_id', user.id).eq('product_id', product_id).single();

            if (existing) {
                // SECURITY PATCH 2: Cegah penumpukan keranjang di luar batas (Limitasi DoS)
                const newTotalQty = existing.quantity + safeQuantity;
                if (newTotalQty > 1000) return res.status(400).json({ error: 'Kouta maksimal per barang tercapai' });

                const { error } = await supabase.from('gg_cart_items')
                    .update({ quantity: newTotalQty })
                    .eq('id', existing.id);
                if (error) throw new Error('Gagal memperbarui jumlah barang');
            } else {
                const { error } = await supabase.from('gg_cart_items').insert([{
                    user_id: user.id, 
                    product_id, 
                    product_name: realProduct.title,  // Terjamin aman dari manipulasi
                    product_price: securePrice,       // Terjamin aman dari Injeksi Harga
                    product_img: realProduct.img,
                    quantity: safeQuantity            // Telah divalidasi mutlak
                }]);
                if (error) throw new Error('Gagal memasukkan barang ke keranjang');
            }
            return res.status(200).json({ message: 'Berhasil masuk keranjang, tervalidasi server' });
        }
        // DELETE: MENGHAPUS BARANG DARI KERANJANG
        else if (req.method === 'DELETE') {
            const { id } = req.body; 
            
            // SECURITY PATCH 3: Validasi ID sebelum menghapus
            if (!id) return res.status(400).json({ error: 'ID Barang tidak valid' });

            const { error } = await supabase.from('gg_cart_items').delete().eq('id', id).eq('user_id', user.id);
            if (error) throw new Error('Gagal menghapus barang');
            return res.status(200).json({ message: 'Barang dihapus' });
        } else {
            return res.status(405).json({ error: 'Metode tidak diizinkan' });
        }
    } catch (error) {
        // SECURITY PATCH 4: Mencegah Information Disclosure Database Supabase
        console.error("Cart API Error:", error);
        return res.status(400).json({ error: error.message || 'Terjadi kesalahan sistem' });
    }
}
