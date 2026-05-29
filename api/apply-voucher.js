export default async function handler(req, res) {
    // Hanya menerima request tipe POST
    if (req.method !== 'POST') return res.status(405).json({ error: 'Metode tidak diizinkan' });

    const { code, total_price } = req.body;
    const subtotal = parseInt(total_price); // Total belanja sebelum diskon

    // --- DATABASE ATURAN VOUCHER ---
    // Di masa depan, ini ditarik dari tabel gg_vouchers di Supabase. 
    // Untuk sekarang, kita atur aturannya langsung di mesin ini agar aman.
    const vouchers = {
        'NEWGROSIR20': { type: 'percent', value: 0.2, max_discount: null, min_purchase: 0 },
        'COMEBACK50':  { type: 'fixed', value: 50000, max_discount: null, min_purchase: 100000 },
        
        // INI VOUCHER REQUEST ANDA: Diskon 50%, Maksimal Rp 25.000
        'HEMAT50': { 
            type: 'percent', 
            value: 0.5,             // 50%
            max_discount: 25000,    // Mentok di Rp 25.000
            min_purchase: 0         // Tanpa minimal belanja
        }
    };

    // 1. Cek apakah kode voucher ada di sistem
    const voucher = vouchers[code.toUpperCase()];
    if (!voucher) {
        return res.status(400).json({ error: 'Kode promo tidak valid atau kadaluarsa.' });
    }

    // 2. Cek apakah memenuhi minimal belanja
    if (subtotal < voucher.min_purchase) {
        return res.status(400).json({ error: `Minimal belanja Rp ${voucher.min_purchase.toLocaleString('id-ID')} untuk pakai kode ini.` });
    }

    // 3. MENGHITUNG DISKON
    let discountAmount = 0;

    if (voucher.type === 'percent') {
        discountAmount = subtotal * voucher.value; // Hitung persentase
        
        // LOGIKA BATAS MAKSIMAL (CAP):
        if (voucher.max_discount !== null && discountAmount > voucher.max_discount) {
            discountAmount = voucher.max_discount; // Mentokkan ke Rp 25.000
        }
    } else if (voucher.type === 'fixed') {
        discountAmount = voucher.value; // Diskon uang pas (contoh: potongan 50rb)
    }

    // Pastikan diskon tidak membuat tagihan jadi minus (di bawah 0)
    if (discountAmount > subtotal) discountAmount = subtotal;

    const finalTotal = subtotal - discountAmount;

    // 4. Kirim hasil hitungan resmi kembali ke layar pengguna
    return res.status(200).json({
        message: 'Yeay! Promo berhasil digunakan.',
        discount_amount: discountAmount,
        final_total: finalTotal
    });
}