import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Metode tidak diizinkan' });

    // Cek Tiket Keamanan Pengguna
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'Akses Ditolak: Anda belum login' });
    const token = authHeader.split(' ')[1];

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: `Bearer ${token}` } }
    });

    try {
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) throw new Error('Sesi login tidak valid');

        // INTELIJEN PEMASARAN: Hitung jumlah transaksi pengguna ini di database
        const { count: orderCount, error: orderError } = await supabase
            .from('gg_orders')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', user.id);

        // Hitung umur akun pengguna
        const createdAt = new Date(user.created_at);
        const now = new Date();
        const daysSinceCreated = (now - createdAt) / (1000 * 60 * 60 * 24);

        let availableVouchers = [];

        // STRATEGI 1: PENGGUNA BARU (Umur akun < 14 hari & belum pernah belanja)
        if (orderCount === 0 && daysSinceCreated <= 14) {
            availableVouchers.push({
                id: 'VCH-NEW20',
                code: 'NEWGROSIR20',
                title: 'Diskon Pengguna Baru 20%',
                desc: 'Selamat datang di Goedang! Nikmati potongan 20% tanpa minimal belanja untuk pesanan pertamamu.',
                color: '#27ae60' // Hijau Neumorphism
            });
        }

        // STRATEGI 2: GODAAN COMEBACK (Belum pernah belanja tapi akun sudah lama > 14 hari)
        if (orderCount === 0 && daysSinceCreated > 14) {
            availableVouchers.push({
                id: 'VCH-MISS',
                code: 'COMEBACK50',
                title: 'Potongan Tunai Rp 50.000',
                desc: 'Kami merindukanmu! Ragu untuk checkout? Pakai kode ini dan dapatkan potongan tunai langsung Rp 50.000.',
                color: '#e67e22' // Oranye Neumorphism
            });
        }

        // STRATEGI 3: PELANGGAN SETIA (Sudah pernah belanja 3 kali atau lebih)
        if (orderCount >= 3) {
            availableVouchers.push({
                id: 'VCH-LOYAL',
                code: 'BOSGROSIR',
                title: 'Diskon Spesial Bos Grosir',
                desc: 'Terima kasih telah setia berbelanja! Nikmati potongan Rp 100.000 khusus untuk mitra bisnis kami.',
                color: '#8e44ad' // Ungu Neumorphism
            });
        }

        // STRATEGI 4: VOUCHER UMUM (Semua pengguna selalu dapat ini)
        availableVouchers.push({
            id: 'VCH-ONGKIR',
            code: 'GRATISONGKIR',
            title: 'Subsidi Ongkir Rp 20.000',
            desc: 'Bebas biaya kirim ke seluruh Batam untuk minimal pembelanjaan partai Rp 500.000.',
            color: '#0984e3' // Biru Neumorphism
        });

        // Kembalikan daftar voucher ke frontend
        return res.status(200).json(availableVouchers);
    } catch (error) {
        return res.status(400).json({ error: error.message });
    }
}