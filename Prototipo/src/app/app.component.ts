import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet } from '@angular/router';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { createWorker } from 'tesseract.js';
import * as pdfjsLib from 'pdfjs-dist';

import { OcrParserService, DatosPensionado } from './ocr-parser.service';
import { DragDropDirective } from './directives/drag-drop.directive';

pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, CommonModule, MatProgressBarModule, DragDropDirective],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css'
})
export class AppComponent {
  title = 'Prototipo';

  private parserService = inject(OcrParserService);

  archivoSeleccionado: File | null = null;
  uploadProgress: number | null = null;
  textoExtraido: string = '';
  confianza: number = 0;

  datosJson: DatosPensionado | null = null;
  tabActiva: 'texto' | 'json' = 'texto';

  async onFileDropped(files: FileList): Promise<void> {
    if (!files || files.length === 0) return;
    await this.procesarArchivo(files[0]);
  }

  async onFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;
    await this.procesarArchivo(input.files[0]);
  }

  private async procesarArchivo(archivo: File): Promise<void> {
    this.archivoSeleccionado = archivo;
    this.textoExtraido = '';
    this.confianza = 0;

    try {
      if (archivo.type === 'application/pdf') {
        await this.procesarPdfMultipagina(archivo);
      } else if (archivo.type.startsWith('image/')) {
        await this.procesarImagen(archivo);
      } else {
        alert('Formato no soportado. Sube una imagen o un PDF');
        this.quitarArchivo();
      }
    } catch (error) {
      console.error('Error al procesar el archivo: ', error);
      alert('Ocurrio un error en el procesamiento del archivo');
      this.quitarArchivo();
    }
  }

  private async procesarPdfMultipagina(archivoPdf: File): Promise<void> {
    this.uploadProgress = 5;

    const arrayBuffer = await archivoPdf.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const totalPaginas = pdf.numPages;

    let textoAcumulado = '';
    let sumaConfianzas = 0;
    let paginasConOcr = 0;

    const worker = await createWorker('spa', 1);

    for (let numPagina = 1; numPagina <= totalPaginas; numPagina++) {
      const pagina = await pdf.getPage(numPagina);

      const textoNativo = await pagina.getTextContent();
      const lineasTexto = textoNativo.items
        .map((item: any) => item.str)
        .join('\n');

      if (lineasTexto.trim().length > 50) {
        textoAcumulado += `--- PÁGINA ${numPagina} (Texto Nativo) ---\n\n${lineasTexto}\n\n`;
        sumaConfianzas += 100;
        paginasConOcr++;
      } else {
        const viewport = pagina.getViewport({ scale: 3.5 });
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d')!;

        canvas.height = viewport.height;
        canvas.width = viewport.width;

        context.fillStyle = '#FFFFFF';
        context.fillRect(0, 0, canvas.width, canvas.height);

        await pagina.render({ canvasContext: context, viewport } as any).promise;

        const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;
        const width = canvas.width;
        const height = canvas.height;

        for (let i = 0; i < data.length; i += 4) {
          const avg = (data[i] + data[i + 1] + data[i + 2]) / 3;
          const v = avg < 140 ? 0 : 255;
          data[i] = data[i + 1] = data[i + 2] = v;
        }

        const lineThreshold = Math.floor(height * 0.05);
        for (let x = 0; x < width; x++) {
          let count = 0;
          for (let y = 0; y < height; y++) {
            const idx = (y * width + x) * 4;
            if (data[idx] === 0) {
              count++;
            } else {
              if (count > lineThreshold) {
                for (let k = y - count; k < y; k++) {
                  const eraseIdx = (k * width + x) * 4;
                  data[eraseIdx] = data[eraseIdx + 1] = data[eraseIdx + 2] = 255;
                }
              }
              count = 0;
            }
          }
        }

        context.putImageData(imageData, 0, 0);
        const imagenBase64 = canvas.toDataURL('image/png');

        const resultado = await worker.recognize(imagenBase64);
        textoAcumulado += `--- PÁGINA ${numPagina} (OCR HD + Clean) ---\n\n${resultado.data.text}\n\n`;
        sumaConfianzas += resultado.data.confidence;
        paginasConOcr++;
      }

      this.uploadProgress = Math.round((numPagina / totalPaginas) * 100);
    }

    this.textoExtraido = textoAcumulado;
    this.confianza = Math.round(sumaConfianzas / (paginasConOcr || 1));

    this.datosJson = this.parserService.procesarTextoDocumento(textoAcumulado);

    await worker.terminate();
    this.uploadProgress = null;
  }

  async procesarImagen(imagen: File): Promise<void> {
    this.uploadProgress = 10;
    this.textoExtraido = '';
    this.datosJson = null;

    const worker = await createWorker('spa', 1, {
      logger: m => {
        if (m.status === 'recognizing text' && m.progress) {
          this.uploadProgress = Math.round(m.progress * 100);
        }
      }
    });

    const resultado = await worker.recognize(imagen);

    this.textoExtraido = resultado.data.text;
    this.confianza = Math.round(resultado.data.confidence);

    this.datosJson = this.parserService.procesarTextoDocumento(this.textoExtraido);

    await worker.terminate();
    this.uploadProgress = null;
  }

  quitarArchivo(): void {
    this.archivoSeleccionado = null;
    this.uploadProgress = null;
    this.textoExtraido = '';
    this.confianza = 0;
    this.datosJson = null;

    const inputElement = document.getElementById('file') as HTMLInputElement;
    if (inputElement) {
      inputElement.value = '';
    }
  }
}