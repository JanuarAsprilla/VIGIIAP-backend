/** Consulta válida en forma pero no atendible por reglas de negocio (p. ej. grupo solo agregado). */
export class ConsultaInvalida extends Error {
  constructor(mensaje, status = 422) {
    super(mensaje);
    this.name = 'ConsultaInvalida';
    this.status = status;
  }
}
