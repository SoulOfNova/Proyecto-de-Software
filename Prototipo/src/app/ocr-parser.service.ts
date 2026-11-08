import { Injectable } from '@angular/core';

export interface ItemCompra {
  entidad: string;
  valorCuota: number;
}

export interface DatosPensionado {
  valorPension: number | null;
  salud: number | null;
  totalDeducidos: number | null;
  netoGirado: number | null;
  capacidadBaseLey1527: number | null;
  comprasCartera: ItemCompra[];
  totalCuotasLiberadas: number;
  capacidadTotalConCompra: number | null;
}

@Injectable({
  providedIn: 'root'
})
export class OcrParserService {

  private limpiarNumero(monto: string | undefined): number | null {
    if (!monto) return null;

    let texto = monto.trim();

    texto = texto.replace(/[\.,]00$/, '');

    const digitos = texto.replace(/\D/g, '');
    const numero = parseInt(digitos, 10);
    
    return isNaN(numero) ? null : numero;
  }

  public procesarTextoDocumento(texto: string): DatosPensionado {
    const matchPension = texto.match(/(?:VALOR\s*PENSION|TOTAL DEVENGADOS)[^\d]*([\d\.,\s]+)/i);
    const matchSalud = texto.match(/SALUD[^\$]*\$?\s*([\d\.,\s]+)/i);
    const matchDeducidos = texto.match(/TOTAL DEDUCIDOS[^\d]*([\d\.,\s]+)/i);
    const matchNeto = texto.match(/NETO GIRADO[^\d]*([\d\.,\s]+)/i);

    const valorPension = this.limpiarNumero(matchPension?.[1]);
    const salud = this.limpiarNumero(matchSalud?.[1]);
    const totalDeducidos = this.limpiarNumero(matchDeducidos?.[1]);
    const netoGirado = this.limpiarNumero(matchNeto?.[1]);

    const comprasCartera: ItemCompra[] = [];
    let totalCuotasLiberadas = 0;

    const lineas = texto.split('\n');

    for (let i = 0; i < lineas.length; i++) {
      const lineaActual = lineas[i];

      if (/DESCUENTOS?\s+PREST[AÁ][MΜ]O/i.test(lineaActual)) {
        let cuota = 0;

        for (let offset = 0; offset <= 3 && (i + offset) < lineas.length; offset++) {
          const matchMonto = lineas[i + offset].match(/\$\s*([\d\.,\s]+)/);
          if (matchMonto) {
            cuota = this.limpiarNumero(matchMonto[1]) || 0;
            if (cuota > 0) break;
          }
        }

        if (cuota > 0) {
          let textoEntidadAcumulado = '';
          for (let offset = 0; offset <= 3 && (i + offset) < lineas.length; offset++) {
            const l = lineas[i + offset];
            if (/\$\s*[\d\.,\s]+/.test(l) && offset > 0) break;
            
            const textoLimpio = l
              .replace(/^[x\-\.\*\:\s]+/i, '')
              .replace(/DESCUENTOS?\s+PREST[AÁ][MΜ]O[S]?/gi, '')
              .replace(/[^A-Z\s]/gi, ' ')
              .trim();

            if (textoLimpio && !/TOTAL|NETO|ESTADO|VALOR/i.test(textoLimpio)) {
              textoEntidadAcumulado += ' ' + textoLimpio;
            }
          }

          const entidadNombre = textoEntidadAcumulado.replace(/\s+/g, ' ').trim();

          comprasCartera.push({
            entidad: entidadNombre || 'DESCUENTO PRESTAMO',
            valorCuota: cuota
          });
          totalCuotasLiberadas += cuota;
        }
      }
    }

    let capacidadBaseLey1527: number | null = null;
    if (valorPension !== null && salud !== null && totalDeducidos !== null) {
      const baseMedioSalario = Math.floor((valorPension - salud) / 2);
      const resultadoCalculo = baseMedioSalario - totalDeducidos + salud;
      capacidadBaseLey1527 = resultadoCalculo > 0 ? resultadoCalculo : 0;
    }

    const capacidadTotalConCompra = capacidadBaseLey1527 !== null 
      ? capacidadBaseLey1527 + totalCuotasLiberadas 
      : null;

    return {
      valorPension,
      salud,
      totalDeducidos,
      netoGirado,
      capacidadBaseLey1527,
      comprasCartera,
      totalCuotasLiberadas,
      capacidadTotalConCompra
    };
  }
}