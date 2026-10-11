# Guía de contribución — VIGIIAP

Este documento resume cómo trabajamos. Aplica a los dos repositorios de la plataforma:
[VIGIIAP](https://github.com/JanuarAsprilla/VIGIIAP) (frontend) y
[VIGIIAP-backend](https://github.com/JanuarAsprilla/VIGIIAP-backend) (API).

## Flujo de trabajo

Trabajamos sobre una sola rama permanente, `main`, siempre desplegable y protegida.

1. Crea una rama corta desde `main` con un nombre descriptivo:
   `feat/…`, `fix/…`, `chore/…`, `docs/…`, `perf/…`, `test/…`.
2. Haz commits pequeños y atómicos.
3. Abre un Pull Request hacia `main`. El título sigue la convención de commits.
4. Espera a que el CI pase completo y fusiona con **Squash and merge**.
   Las ramas fusionadas se borran solas.

`main` no admite pushes directos ni force-push.

## Commits convencionales

Seguimos [Conventional Commits](https://www.conventionalcommits.org):

```
<tipo>(<alcance opcional>): <descripción en imperativo>
```

| Tipo | Cuándo |
|---|---|
| `feat` | Nueva funcionalidad |
| `fix` | Corrección de un error |
| `refactor` | Cambio interno sin efecto funcional |
| `perf` | Mejora de rendimiento |
| `test` | Pruebas |
| `docs` | Solo documentación |
| `chore` / `ci` | Mantenimiento, dependencias, CI |

Ejemplos: `feat(geovisores): asistente por pasos`, `fix(auth): renovar sesión con cookie caducada`.

## Versiones

Las versiones y el `CHANGELOG.md` los genera **release-please** a partir de los commits.
No edites la versión ni el changelog a mano: al fusionar a `main`, release-please abre
(o actualiza) un PR «release». Fusionarlo publica la versión.

## Antes de abrir un Pull Request

- [ ] El proyecto compila y pasa lint, tipos y pruebas en local (`npm run lint`, `npm test`).
- [ ] Hay pruebas para el comportamiento nuevo o corregido; la cobertura no baja.
- [ ] No quedan `console.log`, código comentado ni credenciales.
- [ ] Si cambia la configuración, se actualizó `.env.example` y el README.
- [ ] El PR resuelve **una sola cosa**; si toca muchos archivos sin relación, divídelo.

**Backend:** las migraciones de `db/migrations/` son consecutivas, idempotentes y nunca se
editan una vez fusionadas.
**Frontend:** textos de interfaz en español, componentes accesibles (etiquetas en botones de
icono, foco visible, contraste AA) y probados en móvil.

## Seguridad

Nunca subas secretos. Para reportar una vulnerabilidad sigue [SECURITY.md](SECURITY.md);
no abras un issue público.
