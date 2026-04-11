import * as solService from './solicitudes.service.js';

export async function index(req, res, next) {
  try { res.json(await solService.getAll(req.query)); } catch (err) { next(err); }
}

export async function mine(req, res, next) {
  try { res.json(await solService.getMine(req.user.id, req.query)); } catch (err) { next(err); }
}

export async function store(req, res, next) {
  try {
    res.status(201).json(await solService.create(req.body, req.user.id));
  } catch (err) { next(err); }
}

export async function updateEstado(req, res, next) {
  try {
    const { estado, nota } = req.body;
    res.json(await solService.updateEstado(req.params.id, estado, nota, req.user.id));
  } catch (err) { next(err); }
}
