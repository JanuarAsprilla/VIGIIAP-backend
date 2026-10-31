#!/usr/bin/env python3
"""Convierte la base SQLite de origen al formato de carga de Vigía (NDJSON comprimido).

Uso único y local (no corre en producción):
    python3 -I scripts/biodiversidad/exportar_desde_sqlite.py --entrada choco_gbif.sqlite --salida datos.ndjson.gz

Exporta solo los cortes ACTIVOS y completos y el cruce de conservación activo, en orden de
dependencias. Cada línea es {"t": tabla, "d": fila}; la primera es el manifiesto con los conteos
esperados que el cargador (scripts/biodiversidad/cargar.js) verifica antes de confirmar.
Se niega a escribir el archivo si detecta rutas de otros equipos o datos personales.
"""
import argparse
import gzip
import hashlib
import json
import re
import sqlite3
import sys
from datetime import datetime, timezone

FORMATO = 1
# Mismo criterio que la API: solo imágenes de la caché de GBIF y referencias https. Nunca se exporta
# la URL original del autor (`original`), el origen interno ni el gbif_id repetido de cada foto.
FOTO_IMAGEN = re.compile(r'^https://api\.gbif\.org/v1/image/cache/[0-9]+x/occurrence/[0-9]+/media/[a-f0-9]{32}$')
FOTO_CAMPOS = ('imagen', 'autor', 'editor', 'licencia', 'referencia')
FOTOS_DESCARTADAS = {'n': 0}
MARCA_GBIF = re.compile(r'^[A-Z][A-Z0-9_]{2,80}$')
# Se revisan los VALORES de texto (no el JSON serializado): una unidad de disco solo cuenta si
# arranca el texto o sigue a un espacio (p. ej. «C:\Users\…»), no el «Métodos:\n» de una metodología.
FUGA = re.compile(r'(?:^|\s)[A-Za-z]:\\|\\Users\\|ebedi|\.codex|(?:^|\s)/(?:Users|home)/[^/\s]+/', re.IGNORECASE)


def hay_fuga(valor):
    if isinstance(valor, str):
        return FUGA.search(valor) is not None
    if isinstance(valor, dict):
        return any(hay_fuga(v) for v in valor.values())
    if isinstance(valor, (list, tuple)):
        return any(hay_fuga(v) for v in valor)
    return False
ORIGEN_LOTE = 'gbif-api'
ORIGEN_TERRITORIO = 'region_choco_2026/municipios_original.geojson'


def abrir(ruta):
    con = sqlite3.connect(f'file:{ruta}?mode=ro', uri=True)
    con.row_factory = sqlite3.Row
    return con


def sha256_archivo(ruta):
    h = hashlib.sha256()
    with open(ruta, 'rb') as f:
        for bloque in iter(lambda: f.read(1 << 20), b''):
            h.update(bloque)
    return h.hexdigest()


def json_o_vacio(texto, defecto):
    return json.loads(texto) if texto else defecto


def fotos_publicas(texto):
    """Fotos exportables de un registro: solo los campos públicos y solo las que pasan la validación."""
    publicas = []
    for f in json_o_vacio(texto, []):
        if (isinstance(f, dict) and isinstance(f.get('imagen'), str) and FOTO_IMAGEN.match(f['imagen'])
                and isinstance(f.get('referencia'), str) and f['referencia'].startswith('https://')):
            publicas.append({c: (f.get(c) or None) for c in FOTO_CAMPOS})
        else:
            FOTOS_DESCARTADAS['n'] += 1
    return publicas


def marcas_gbif(texto):
    """Códigos de calidad de GBIF: solo cadenas con forma de código, sin repetidos."""
    codigos = []
    for c in json_o_vacio(texto, []):
        if isinstance(c, str) and MARCA_GBIF.match(c) and c not in codigos:
            codigos.append(c)
    return codigos


def marcadores(n):
    return ','.join('?' * n)


def tablas(con):
    """Define, en orden de dependencias, cada tabla: consulta, parámetros y transformación de fila."""
    lotes = [r['id'] for r in con.execute("SELECT id FROM lote WHERE activo = 1 AND estado = 'completo' ORDER BY id")]
    imps = [r['id'] for r in con.execute('SELECT id FROM conservacion_importacion WHERE activo = 1')]
    if not lotes or len(imps) != 1:
        raise SystemExit(f'Se esperaban lotes activos y exactamente 1 cruce activo; hay {len(lotes)} lotes y {len(imps)} cruces.')
    L, I = marcadores(len(lotes)), imps[0]
    huellas = f'SELECT DISTINCT territorio_huella FROM lote WHERE id IN ({L})'
    taxones = (f'SELECT taxon_huella FROM registro WHERE lote_id IN ({L}) AND taxon_huella IS NOT NULL '
               f'UNION SELECT taxon_huella FROM inventario_especie WHERE lote_id IN ({L})')
    conjuntos = (f'SELECT dataset_key FROM registro WHERE lote_id IN ({L}) '
                 f'UNION SELECT dataset_key FROM conteo_fuente WHERE lote_id IN ({L})')
    por_lote = lambda t: (f'SELECT * FROM {t} WHERE lote_id IN ({L})', lotes)

    def con_linaje(r):
        d = {k: r[k] for k in r.keys() if k != 'linaje_json'}
        d['linaje'] = json_o_vacio(r['linaje_json'], {})
        return d

    definiciones = [
        ('clasificacion', f'SELECT * FROM clasificacion WHERE clave IN (SELECT clasificacion_clave FROM lote WHERE id IN ({L}))',
         lotes, lambda r: dict(r)),
        ('territorio_version', f'SELECT huella FROM territorio_version WHERE huella IN ({huellas})', lotes,
         lambda r: {'huella': r['huella'], 'origen': ORIGEN_TERRITORIO}),
        ('municipio', f'SELECT * FROM municipio WHERE territorio_huella IN ({huellas})', lotes, lambda r: dict(r)),
        ('entidad', f'SELECT * FROM entidad WHERE clave IN (SELECT entidad_clave FROM conjunto WHERE clave IN ({conjuntos}))',
         lotes + lotes,
         lambda r: {'clave': r['clave'], 'nombre': r['nombre'], 'metadatos': json_o_vacio(r['metadatos_json'], {}),
                    'consultado_en': r['consultado_utc']}),
        ('conjunto', f'SELECT * FROM conjunto WHERE clave IN ({conjuntos})', lotes + lotes,
         lambda r: {'clave': r['clave'], 'titulo': r['titulo'], 'entidad_clave': r['entidad_clave'], 'doi': r['doi'],
                    'licencia': r['licencia'], 'metadatos': json_o_vacio(r['metadatos_json'], {}),
                    'consultado_en': r['consultado_utc']}),
        ('lote', f'SELECT * FROM lote WHERE id IN ({L}) ORDER BY id', lotes,
         lambda r: {'ref': r['id'], 'grupo': r['grupo'], 'metodo': r['metodo'], 'clasificacion_clave': r['clasificacion_clave'],
                    'territorio_huella': r['territorio_huella'], 'desde': r['desde'], 'hasta': r['hasta'],
                    'huella_fuente': r['huella_fuente'], 'origen': ORIGEN_LOTE, 'doi': r['doi'],
                    'creado_en': r['creado_utc'], 'fecha_fuente': r['fecha_fuente_utc'], 'registros': r['registros']}),
        ('taxon_version', f'SELECT * FROM taxon_version WHERE huella IN ({taxones})', lotes + lotes, con_linaje),
        ('registro', f'SELECT * FROM registro WHERE lote_id IN ({L}) ORDER BY lote_id, gbif_id', lotes,
         lambda r: {**{k: r[k] for k in ('gbif_id', 'dataset_key', 'taxon_huella', 'occurrence_id', 'fecha_evento', 'anio',
                                         'latitud', 'longitud', 'incertidumbre_m', 'tipo_evidencia', 'licencia',
                                         'institution_code', 'collection_code', 'catalog_number', 'nombre_original',
                                         'last_interpreted', 'modified', 'marcas_revision')},
                    'lote': r['lote_id'], 'vista_1000m': bool(r['vista_1000m'])}),
        ('asignacion', f'SELECT * FROM asignacion WHERE lote_id IN ({L}) ORDER BY lote_id, gbif_id, codigo', lotes,
         lambda r: {'lote': r['lote_id'], 'gbif_id': r['gbif_id'], 'territorio_huella': r['territorio_huella'],
                    'codigo': r['codigo']}),
        ('resumen_territorial', *por_lote('resumen_territorial'),
         lambda r: {'lote': r['lote_id'], 'territorio_huella': r['territorio_huella'], 'codigo': r['codigo'],
                    'registros': r['registros'], 'sin_especie': r['sin_especie']}),
        ('inventario_especie', *por_lote('inventario_especie'),
         lambda r: {'lote': r['lote_id'], 'codigo': r['codigo'], 'taxon_huella': r['taxon_huella'],
                    'registros': r['registros']}),
        ('conteo_fuente', *por_lote('conteo_fuente'),
         lambda r: {'lote': r['lote_id'], 'codigo': r['codigo'], 'dataset_key': r['dataset_key'],
                    'registros': r['registros']}),
        ('faceta_municipal', *por_lote('faceta_municipal'),
         lambda r: {'lote': r['lote_id'], 'codigo': r['codigo'], 'faceta': r['faceta'], 'valor': r['valor'],
                    'registros': r['registros']}),
        ('conservacion_importacion', 'SELECT * FROM conservacion_importacion WHERE id = ?', [I],
         lambda r: {'ref': r['id'], 'creado_en': r['creado_utc'], 'huella': r['huella'],
                    'informe': json_o_vacio(r['informe_json'], {})}),
        ('conservacion_fuente', 'SELECT * FROM conservacion_fuente WHERE importacion = ? ORDER BY slug', [I],
         lambda r: {'importacion': r['importacion'], 'slug': r['slug'],
                    'metadatos': json_o_vacio(r['metadatos_json'], {})}),
        ('conservacion_afirmacion', 'SELECT * FROM conservacion_afirmacion WHERE importacion = ? ORDER BY id', [I],
         lambda r: {'ref': r['id'], 'importacion': r['importacion'], 'fuente': r['fuente'], 'id_original': r['id_original'],
                    'nombre': r['nombre'], 'reino': r['reino'], 'rango': r['rango'], 'tema': r['tema'],
                    'valor': r['valor'], 'campo': r['campo'], 'original': json_o_vacio(r['original_json'], {}),
                    'motivo_revision': r['motivo_revision']}),
        ('conservacion_vinculo',
         'SELECT v.* FROM conservacion_vinculo v JOIN conservacion_afirmacion a ON a.id = v.afirmacion '
         'WHERE a.importacion = ? ORDER BY v.afirmacion, v.clasificacion, v.especie_clave', [I],
         lambda r: {'afirmacion': r['afirmacion'], 'clasificacion_clave': r['clasificacion'],
                    'especie_clave': r['especie_clave'], 'metodo': r['metodo']}),
    ]
    # El detalle (observador, identificador, fotos) es opcional: una base anterior sin esa tabla exporta igual.
    hay_detalle = con.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'detalle_registro'").fetchone()
    if not hay_detalle:
        return definiciones
    detalle = (
        'registro_detalle', f'SELECT * FROM detalle_registro WHERE lote_id IN ({L}) ORDER BY lote_id, gbif_id', lotes,
        lambda r: {'lote': r['lote_id'], 'gbif_id': r['gbif_id'], 'registrado_por': r['registrado_por'] or None,
                   'identificado_por': r['identificado_por'] or None, 'fotos': fotos_publicas(r['fotos_json']), 'marcas_gbif': marcas_gbif(r['revision_json'])},
    )
    posicion = next(i for i, d in enumerate(definiciones) if d[0] == 'registro') + 1
    return definiciones[:posicion] + [detalle] + definiciones[posicion:]


def exportar(entrada, salida):
    con = abrir(entrada)
    defs = tablas(con)
    conteos = {nombre: con.execute(f'SELECT count(*) FROM ({sql})', params).fetchone()[0] for nombre, sql, params, _ in defs}
    manifiesto = {'formato': FORMATO, 'generado': datetime.now(timezone.utc).isoformat(),
                  'fuente_sha256': sha256_archivo(entrada), 'conteos': conteos}
    escritas = 0
    with gzip.open(salida, 'wt', encoding='utf-8', compresslevel=9) as out:
        def escribir(obj):
            linea = json.dumps(obj, ensure_ascii=False, separators=(',', ':'))
            if hay_fuga(obj):
                raise SystemExit(f'Se detectó una ruta local o dato personal; no se genera el archivo: {linea[:160]}')
            out.write(linea + '\n')

        escribir({'t': 'manifiesto', 'd': manifiesto})
        for nombre, sql, params, transformar in defs:
            n = 0
            for r in con.execute(sql, params):
                escribir({'t': nombre, 'd': transformar(r)})
                n += 1
            if n != conteos[nombre]:
                raise SystemExit(f'{nombre}: se exportaron {n} filas y se esperaban {conteos[nombre]}')
            escritas += n
    return conteos, escritas


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('--entrada', required=True)
    p.add_argument('--salida', required=True)
    a = p.parse_args()
    conteos, total = exportar(a.entrada, a.salida)
    for nombre, n in conteos.items():
        print(f'{nombre:28s}{n:>9d}')
    print(f'{"TOTAL":28s}{total:>9d}')
    if FOTOS_DESCARTADAS['n']:
        print(f'Fotos descartadas por no cumplir la validación: {FOTOS_DESCARTADAS["n"]}', file=sys.stderr)
    return 0


if __name__ == '__main__':
    sys.exit(main())
