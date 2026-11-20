# M4 por elemento — subtipo final contra os rótulos

2026-11-20T13:13:17+00:00 · 194 recortes rotulados casados. Elemento "específico" = o rótulo mais frequente dos seus recortes de frente é STOP / cedência / limite.

| Voto | específicos | certo (auto) | certo (fila) | fila sem tipo | perdido (outro, sem fila) | errado | falsos específicos sem fila |
|---|---:|---:|---:|---:|---:|---:|---:|
| especifico | 5 | 3 | 2 | 0 | 0 | 0 | 0 (+0 na fila) de 35 |

## especifico

| Elemento | Rótulos | Vistas (M4) | Subtipo | Resultado | Motivo |
|---|---|---|---|---|---|
| sin_0055 | {'costas': 2, 'cedencia': 1} | {'outro_sinal': 1, 'costas': 1, 'cedencia_passagem': 1} | cedencia_passagem (fila) | certo_fila | cedencia_passagem visto numa só vista certa |
| sin_0025 | {'cedencia': 4} | {'cedencia_passagem': 4} | cedencia_passagem | certo_auto |  |
| sin_0038 | {'stop': 1} | {'stop': 1} | stop (fila) | certo_fila | stop visto numa só vista certa |
| sin_0001 | {'stop': 5, 'nao_sinal': 9, 'outro_frente': 6} | {'stop': 5, 'outro_sinal': 16, 'costas': 1} | stop | certo_auto |  |
| sin_0079 | {'cedencia': 5, 'nao_sinal': 5, 'costas': 2, 'outro_frente': 1, 'limite_40': 3} | {'outro_sinal': 8, 'cedencia_passagem': 5, 'costas': 1, 'limite_desconhecido': 3} | cedencia_passagem | certo_auto |  |
