export type Group = { id: string; name: string; type: "ARISAN" | "KAS"; role: string };
export type Member = { id: string; name: string; role: string };
export const roles: Record<string, string> = { OWNER: "Pemilik", TREASURER: "Bendahara", MEMBER: "Anggota" };

export async function groupRequest(path = "", method = "GET", payload?: object, key?: string) {
  const response = await fetch(`/api/v1/groups${path}`, {
    method,
    headers: {
      ...(payload ? { "Content-Type": "application/json" } : {}),
      ...(key ? { "Idempotency-Key": key } : {}),
    },
    body: payload ? JSON.stringify(payload) : undefined,
    cache: "no-store",
  });
  if (response.status === 401) {
    window.location.replace("/masuk?sesi=1");
    throw new Error("Sesi perlu diperbarui. Silakan ulangi tindakanmu.");
  }
  if (!response.ok) {
    if (response.status === 429) throw new Error("Terlalu banyak percobaan. Tunggu sebentar lalu coba lagi.");
    if (response.status === 409) throw new Error("Tindakan tidak tersedia pada status saat ini. Muat ulang jika data berubah.");
    if (response.status === 410) throw new Error("Undangan kedaluwarsa atau kuotanya sudah habis.");
    if (response.status === 404) throw new Error("Kelompok atau undangan tidak ditemukan.");
    if (response.status === 403) throw new Error("Kamu tidak memiliki izin untuk melakukan tindakan ini.");
    throw new Error("Permintaan gagal. Periksa input dan coba lagi.");
  }
  return response.status === 204 ? undefined : response.json();
}

