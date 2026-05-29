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

        // Tarik Total Pesanan (Pakai safe fallback)
        const { count: orderCount } = await supabase.from('gg_orders').select('*', { count: 'exact', head: true }).eq('user_id', user.id);
        const safeOrderCount = orderCount || 0;

        const { data: claimedData } = await supabase.from('gg_claimed_vouchers').select('voucher_code').eq('user_id', user.id);
        const claimedCodes = claimedData ? claimedData.map(c => c.voucher_code) : [];

        const now = new Date();
        const daysSinceCreated = user.created_at ? (now - new Date(user.created_at)) / (1000 * 60 * 60 * 24) : 0;
        const daysSinceLastSignIn = user.last_sign_in_at ? (now - new Date(user.last_sign_in_at)) / (1000 * 60 * 60 * 24) : 0;

        const { data: dbVouchers, error: dbError } = await supabase.from('gg_vouchers').select('*').order('id', { ascending: true });
        if (dbError) throw dbError;

        const filteredVouchers = (dbVouchers || []).filter(vch => {
            if (claimedCodes.includes(vch.code)) return false;

            if (vch.target_segment === 'all') return true;
            if (vch.target_segment === 'new' && safeOrderCount === 0 && daysSinceCreated <= 14) return true;
            if (vch.target_segment === 'comeback' && safeOrderCount === 0 && daysSinceCreated > 14 && daysSinceLastSignIn > 14) return true;
            if (vch.target_segment === 'window_shopper' && safeOrderCount === 0 && daysSinceLastSignIn <= 7) return true;
            if (vch.target_segment === 'loyal' && safeOrderCount >= 3) return true;
            
            return false;
        });

        const responseData = filteredVouchers.map(v => ({
            id: v.id.toString(), code: v.code, title: v.title, desc: v.description || '', color: v.color || '#0984e3'
        }));

        return res.status(200).json(responseData);
    } catch (error) { return res.status(400).json({ error: error.message }); }
}
