import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
    // Menarik kunci rahasia dari Vercel
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;
    
    const supabase = createClient(supabaseUrl, supabaseKey);

    try {
        // 1. Mengambil daftar semua nama file dari dalam bucket bernama 'logos'
        const { data: files, error } = await supabase
            .storage
            .from('logos') // Pastikan nama bucket Anda di Supabase adalah "logos"
            .list(); 

        if (error) throw error;

        // 2. Membersihkan file kosong/sampah bawaan sistem
        const validFiles = files.filter(file => file.name !== '.emptyFolderPlaceholder');

        // 3. Merakit URL Publik untuk masing-masing gambar
        const logoUrls = validFiles.map(file => {
            const { data: publicUrlData } = supabase
                .storage
                .from('logos')
                .getPublicUrl(file.name);
                
            return {
                name: file.name,
                url: publicUrlData.publicUrl
            };
        });

        // 4. Kirim daftar URL gambar ke website
        res.status(200).json(logoUrls);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}