const wibDate = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Jakarta", dateStyle: "short" });
const rupiah = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });

export function isOverdue(dueDate: string, now = new Date()) {
  return dueDate < wibDate.format(now);
}

export function paymentNudge(group: string, member: string, amount: string, dueDate: string) {
  const text = `Halo ${member}, iuran kelompok ${group} sebesar ${rupiah.format(BigInt(amount))} jatuh tempo pada ${dueDate} (WIB). Mohon cek statusnya di Arisanly. Jika sudah membayar, abaikan pesan ini. Terima kasih.`;
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}
