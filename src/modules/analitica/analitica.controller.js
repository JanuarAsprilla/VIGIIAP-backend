import { z } from 'zod';
import * as analiticaService from './analitica.service.js';

const rutaSchema = z.string().min(1).max(300);
const pageviewSchema = z.object({
  sessionId: z.string().uuid(),
  ruta: rutaSchema,
  titulo: z.string().max(200).nullable().optional(),
  dispositivo: z.enum(['movil', 'tablet', 'escritorio']),
  navegador: z.string().max(40).nullable().optional(),
  sistemaOperativo: z.string().max(40).nullable().optional(),
  referrerInicial: z.string().max(300).nullable().optional(),
  utmSource: z.string().max(100).nullable().optional(),
  utmMedium: z.string().max(100).nullable().optional(),
  utmCampaign: z.string().max(100).nullable().optional(),
  esAreaAdmin: z.boolean().optional().default(false),
});

function rangoFechas(req) {
  const hasta = req.query.hasta ? new Date(req.query.hasta) : new Date();
  const desde = req.query.desde
    ? new Date(req.query.desde)
    : new Date(hasta.getTime() - 14 * 24 * 60 * 60 * 1000);
  return { desde, hasta };
}

export async function pageview(req, res, next) {
  try {
    const parseResult = pageviewSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: parseResult.error.errors[0].message });
    }
    await analiticaService.registrarPageview({
      ...parseResult.data,
      userAgent: req.get('user-agent'),
    });
    res.status(204).end();
  } catch (err) { next(err); }
}

export async function resumen(_req, res, next) {
  try {
    res.json(await analiticaService.getResumen());
  } catch (err) { next(err); }
}

export async function paginasTop(req, res, next) {
  try {
    res.json(await analiticaService.getPaginasTop(rangoFechas(req)));
  } catch (err) { next(err); }
}

export async function dispositivos(req, res, next) {
  try {
    res.json(await analiticaService.getDispositivos(rangoFechas(req)));
  } catch (err) { next(err); }
}

export async function fuentesTrafico(req, res, next) {
  try {
    res.json(await analiticaService.getFuentesTrafico(rangoFechas(req)));
  } catch (err) { next(err); }
}

export async function entradaSalida(req, res, next) {
  try {
    res.json(await analiticaService.getEntradaSalida(rangoFechas(req)));
  } catch (err) { next(err); }
}
