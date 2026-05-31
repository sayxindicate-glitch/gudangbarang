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

        if (req.method === 'GET') {
            const { data, error } = await supabase.from('gg_cart_items').select('*').eq('user_id', user.id);
            if (error) throw error;
            return res.status(200).json(data);
        } 
        else if (req.method === 'POST') {
            const { product_id, quantity } = req.body; // HANYA TERIMA ID DAN QTY DARI BROWSER
            
            // SECURITY: Tarik nama, gambar, dan harga LANGSUNG dari tabel asli (gg_products)
            const { data: realProduct } = await supabase.from('gg_products').select('title, img, price, promo_price, is_promo').eq('id', product_id).single();
            if (!realProduct) throw new Error('Produk manipulasi terdeteksi');

            const securePrice = (realProduct.is_promo && realProduct.promo_price) ? realProduct.promo_price : realProduct.price;
            
            const { data: existing } = await supabase.from('gg_cart_items').select('*').eq('user_id', user.id).eq('product_id', product_id).single();

            if (existing) {
                const { error } = await supabase.from('gg_cart_items').update({ quantity: existing.quantity + (quantity || 1) }).eq('id', existing.id);
                if (error) throw error;
            } else {
                const { error } = await supabase.from('gg_cart_items').insert([{
                    user_id: user.id, 
                    product_id, 
                    product_name: realProduct.title, // AMAN DARI XSS INJECTION
                    product_price: securePrice,      // AMAN DARI UBAH HARGA
                    product_img: realProduct.img,
                    quantity: quantity || 1
                }]);
                if (error) throw error;
            }
            return res.status(200).json({ message: 'Tervalidasi & masuk keranjang' });
        }
        else if (req.method === 'DELETE') {
            const { id } = req.body; 
            const { error } = await supabase.from('gg_cart_items').delete().eq('id', id).eq('user_id', user.id);
            if (error) throw error;
            return res.status(200).json({ message: 'Barang dihapus' });
        }
    } catch (error) {
        return res.status(400).json({ error: error.message });
    }
}
