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

        // MENGAMBIL DATA KERANJANG
        if (req.method === 'GET') {
            const { data, error } = await supabase.from('gg_cart_items').select('*').eq('user_id', user.id);
            if (error) throw error;
            return res.status(200).json(data);
        } 
        // MENAMBAH BARANG KE KERANJANG
        else if (req.method === 'POST') {
            const { product_id, product_name, product_price, product_img, quantity } = req.body;
            
            // Cek apakah barang sudah ada di keranjang sebelumnya
            const { data: existing } = await supabase.from('gg_cart_items')
                .select('*').eq('user_id', user.id).eq('product_id', product_id).single();

            if (existing) {
                // Jika sudah ada, tambahkan saja jumlahnya
                const { error } = await supabase.from('gg_cart_items')
                    .update({ quantity: existing.quantity + (quantity || 1) })
                    .eq('id', existing.id);
                if (error) throw error;
            } else {
                // Jika belum ada, buat baris baru di keranjang
                const { error } = await supabase.from('gg_cart_items').insert([{
                    user_id: user.id, product_id, product_name, product_price, product_img, quantity: quantity || 1
                }]);
                if (error) throw error;
            }
            return res.status(200).json({ message: 'Berhasil masuk keranjang' });
        }
        // MENGHAPUS BARANG DARI KERANJANG
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