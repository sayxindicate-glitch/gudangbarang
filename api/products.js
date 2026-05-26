import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
    // Vercel akan mengambil kunci rahasia ini dari Environment Variables,
    // sehingga sama sekali tidak terekspos ke frontend HTML Anda.
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;
    
    const supabase = createClient(supabaseUrl, supabaseKey);

    try {
        // Menarik data dari tabel gg_products yang sudah kita buat
        const { data, error } = await supabase
            .from('gg_products')
            .select('*')
            .order('id', { ascending: true });

        if (error) throw error;
        
        // Mengirimkan data dalam bentuk JSON ke website
        res.status(200).json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}