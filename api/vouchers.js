import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Metode tidak diizinkan' });

    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'Akses Ditolak' });
    const token = authHeader.split(' ')[1];

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: `Bearer ${token}` } }
    });

    try {
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) throw new Error('Sesi login tidak valid');

        let safeOrderCount = 0;
        try {
            const { count } = await supabase.from('gg_orders').select('*', { count: 'exact', head: true }).eq('user_id', user.id);
            safeOrderCount = count || 0;
        } catch(e) {}

        let claimedCodes = [];
        try {
            // Ambil data voucher yang SUDAH PERNAH DIPAKAI oleh user ini
            const { data } = await supabase.from('gg_claimed_vouchers').select('voucher_code').eq('user_id', user.id);
            if (data) claimedCodes = data.map(d => d.voucher_code);
        } catch(e) {}

        const now = new Date();
        const createdDate = user.created_at ? new Date(user.created_at) : now;
        const lastSignInDate = user.last_sign_in_at ? new Date(user.last_sign_in_at) : now;
        const daysSinceCreated = Math.max(0, (now - createdDate) / (1000 * 60 * 60 * 24));
        const daysSinceLastSignIn = Math.max(0, (now - lastSignInDate) / (1000 * 60 * 60 * 24));

        // PERBAIKAN: Menghapus .order('created_at') yang menyebabkan Supabase Crash
        const { data: dbVouchers, error: dbError } = await supabase.from('gg_vouchers').select('*');
        
        if (dbError) throw dbError;

        const filteredVouchers = (dbVouchers || []).filter(vch => {
            // Jika target kosong di database, otomatis jadikan 'all'
            const segment = (vch.target_segment || 'all').trim().toLowerCase();
            
            // CEK 1: Sembunyikan jika tanggal sudah lewat
            if (vch.expires_at && new Date(vch.expires_at) < now) return false;

            // CEK 2: Sembunyikan jika sudah pernah dipakai user ini (Mencegah pemakaian berkali-kali)
            if (claimedCodes.includes(vch.code)) return false;

            // CEK 3: Strategi Marketing
            if (segment === 'all') return true;
            if (segment === 'new' && safeOrderCount === 0 && daysSinceCreated <= 14) return true;
            if (segment === 'comeback' && safeOrderCount === 0 && daysSinceCreated > 14 && daysSinceLastSignIn > 14) return true;
            if (segment === 'window_shopper' && safeOrderCount === 0 && daysSinceLastSignIn <= 7) return true;
            if (segment === 'loyal' && safeOrderCount >= 3) return true;
            
            return false;
        });

        const responseData = filteredVouchers.map(v => ({
            id: v.id ? v.id.toString() : Math.random().toString(), 
            code: v.code, 
            title: v.title, 
            desc: v.description || '', 
            color: v.color || '#0984e3',
            expires_at: v.expires_at || null
        }));

        return res.status(200).json(responseData);
    } catch (error) {
        return res.status(400).json({ error: error.message });
    }
}
