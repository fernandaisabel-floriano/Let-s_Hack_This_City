/**
 * Semelhança visual entre dois recortes, calculada no browser: histograma de cor
 * (HSV, 8 tons × 4 saturações × 4 brilhos) comparado pelo coeficiente de Bhattacharyya.
 * Indicativa: fotografias do mesmo objeto de ângulos ou dias diferentes variam;
 * serve para ajudar o técnico a decidir, não decide sozinha.
 */
const cache = new Map<string, Promise<Float32Array | null>>()

function carregar(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = url
  })
}

function histograma(url: string): Promise<Float32Array | null> {
  let p = cache.get(url)
  if (!p) {
    p = carregar(url)
      .then((img) => {
        const s = 48
        const c = document.createElement('canvas')
        c.width = s
        c.height = s
        const ctx = c.getContext('2d', { willReadFrequently: true })
        if (!ctx) return null
        ctx.drawImage(img, 0, 0, s, s)
        const d = ctx.getImageData(0, 0, s, s).data
        const h = new Float32Array(8 * 4 * 4)
        for (let i = 0; i < d.length; i += 4) {
          const r = d[i] / 255
          const g = d[i + 1] / 255
          const b = d[i + 2] / 255
          const mx = Math.max(r, g, b)
          const mn = Math.min(r, g, b)
          const v = mx
          const sat = mx ? (mx - mn) / mx : 0
          let hue = 0
          if (mx !== mn) {
            if (mx === r) hue = ((g - b) / (mx - mn) + 6) % 6
            else if (mx === g) hue = (b - r) / (mx - mn) + 2
            else hue = (r - g) / (mx - mn) + 4
          }
          const hi = Math.min(7, Math.floor((hue / 6) * 8))
          const si = Math.min(3, Math.floor(sat * 4))
          const vi = Math.min(3, Math.floor(v * 4))
          h[hi * 16 + si * 4 + vi] += 1
        }
        const tot = h.reduce((a, x) => a + x, 0) || 1
        for (let i = 0; i < h.length; i++) h[i] /= tot
        return h
      })
      .catch(() => null)
    cache.set(url, p)
  }
  return p
}

/** 0–1 (1 = histogramas iguais), ou null se alguma imagem não carregar. */
export async function semelhancaVisual(urlA: string, urlB: string): Promise<number | null> {
  const [a, b] = await Promise.all([histograma(urlA), histograma(urlB)])
  if (!a || !b) return null
  let bc = 0
  for (let i = 0; i < a.length; i++) bc += Math.sqrt(a[i] * b[i])
  return Math.round(bc * 100) / 100
}
