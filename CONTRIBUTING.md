# Guía de contribución — VIGIIAP

Aplica a los dos repositorios de la plataforma:
[VIGIIAP](https://github.com/JanuarAsprilla/VIGIIAP) (frontend) y
[VIGIIAP-backend](https://github.com/JanuarAsprilla/VIGIIAP-backend) (API).

## Modelo de ramas

Seguimos un flujo **GitFlow simplificado**, con dos ramas permanentes y protegidas:

| Rama | Propósito | Recibe cambios de |
|---|---|---|
| `develop` | Integración. Es la rama por defecto y contiene lo que irá a la próxima versión. | Ramas de trabajo (`feat/…`, `fix/…`, …) |
| `main` | Producción. Cada fusión despliega. | **Solo** `develop` (versiones) y `hotfix/…` (urgencias) |

**Reglas, verificadas automáticamente:**

- Nadie hace push directo a `develop` ni a `main`; todo entra por Pull Request.
- El CI completo debe pasar antes de fusionar.
- Un PR hacia `main` solo se acepta si su origen es `develop`, `hotfix/…` o la rama de release automática.
  La verificación «Origen del PR hacia main» lo comprueba y bloquea el resto.

## Flujo de trabajo diario

1. Crea una rama corta **desde `develop`**: `feat/…`, `fix/…`, `chore/…`, `docs/…`, `perf/…`, `test/…`.
2. Haz commits pequeños y atómicos.
3. Abre un Pull Request **hacia `develop`**. El título sigue la convención de commits.
4. Cuando el CI pase, fusiona con **Squash and merge**. La rama de trabajo se borra sola.

## Publicar una versión (`develop` → `main`)

1. Verifica que `develop` está estable y con el CI en verde.
2. Abre un Pull Request de `develop` hacia `main`.
3. Fusiona con **Create a merge commit** (nunca squash: así `develop` y `main` comparten historia).
4. El despliegue a producción es automático al fusionar en `main`.
5. **release-please** abre un PR de versión (changelog y número de versión) sobre `main`; fusiónalo para publicar la versión.
6. **Sincroniza `develop`:** abre un PR de `main` hacia `develop` y fusiónalo con merge commit, de modo que
   `develop` incorpore la versión publicada. `develop` debe quedar siempre al día con `main`.

## Hotfix (error crítico en producción)

1. Crea `hotfix/descripcion` desde `main`.
2. Abre el PR hacia `main`, con el CI en verde, y fusiónalo.
3. Sincroniza `develop` con `main` (paso 6 anterior) para no perder la corrección.

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

Las versiones y el `CHANGELOG.md` los genera **release-please** a partir de estos commits;
no los edites a mano.

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
