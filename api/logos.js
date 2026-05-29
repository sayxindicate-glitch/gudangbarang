import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;
    
    const supabase = createClient(supabaseUrl, supabaseKey);

    try {
        // Mengambil dari wadah bernama 'logos' di Supabase Storage
        const { data: files, error } = await supabase
            .storage
            .from('logos') 
            .list(); 

        if (error) throw error;

        // Membuang file sampah/placeholder
        const validFiles = files.filter(file => file.name !== '.emptyFolderPlaceholder');

        // Merakit URL gambar agar bisa dibaca oleh HTML
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

        // Kirim ke website Anda
        res.status(200).json(logoUrls);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}
