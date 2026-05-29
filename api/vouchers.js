import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Metode tidak diizinkan' });

    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'Akses Ditolak: Anda belum login' });
    const token = authHeader.split(' ')[1];

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: `Bearer ${token}` } }
    });

    try {
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) throw new Error('Sesi login tidak valid');

        const { count: orderCount } = await supabase
            .from('gg_orders')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', user.id);

        const daysSinceCreated = (new Date() - new Date(user.created_at)) / (1000 * 60 * 60 * 24);

        // Ambil SEMUA baris voucher dari tabel Supabase
        const { data: dbVouchers, error: dbError } = await supabase
            .from('gg_vouchers')
            .select('*')
            .order('id', { ascending: true });
            
        if (dbError) throw dbError;

        // Filter otomatis berdasarkan status pelanggan (baru, lama, loyal)
        const filteredVouchers = dbVouchers.filter(vch => {
            if (vch.target_segment === 'all') return true;
            if (vch.target_segment === 'new' && orderCount === 0 && daysSinceCreated <= 14) return true;
            if (vch.target_segment === 'comeback' && orderCount === 0 && daysSinceCreated > 14) return true;
            if (vch.target_segment === 'loyal' && orderCount >= 3) return true;
            return false;
        });

        const responseData = filteredVouchers.map(v => ({
            id: v.id.toString(),
            code: v.code,
            title: v.title,
            desc: v.description || '',
            color: v.color || '#0984e3'
        }));

        return res.status(200).json(responseData);
    } catch (error) {
        return res.status(400).json({ error: error.message });
    }
}
