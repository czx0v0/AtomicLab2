import { useState, useEffect, useMemo } from 'react';
import { pdfjs } from 'react-pdf';

/** 将笔记中的 bbox 统一为 [x, y, w, h]，供裁剪渲染 */
export function normalizeNoteBbox(bbox) {
  if (bbox == null) return null;
  if (Array.isArray(bbox) && bbox.length >= 4) {
    return [
      Number(bbox[0]),
      Number(bbox[1]),
      Number(bbox[2]),
      Number(bbox[3]),
    ];
  }
  if (typeof bbox === 'object') {
    const x = bbox.x ?? bbox[0];
    const y = bbox.y ?? bbox[1];
    const w = bbox.width ?? bbox.w ?? bbox[2];
    const h = bbox.height ?? bbox.h ?? bbox[3];
    if (x != null && y != null && w != null && h != null) {
      return [Number(x), Number(y), Number(w), Number(h)];
    }
  }
  return null;
}

/**
 * 从 PDF 按页码与 bbox 裁剪预览图。
 * @param fileOrUrl File 对象，或同源 PDF URL 字符串（刷新后 pdfFile 为空时用 pdfUrl）
 * @param pageNumber 页码
 * @param bbox 选区
 */
export const useScreenshot = (fileOrUrl, pageNumber, bbox) => {
  const [imageSrc, setImageSrc] = useState(null);
  const [loading, setLoading] = useState(false);
  const bboxKey = bbox == null ? '' : typeof bbox === 'object' ? JSON.stringify(bbox) : String(bbox);
  const normBbox = useMemo(() => normalizeNoteBbox(bbox), [bboxKey]);

  useEffect(() => {
    if (!fileOrUrl || !normBbox || !pageNumber) return;

    let isActive = true;
    const loadTask = async () => {
      setLoading(true);
      try {
        let arrayBuffer;
        if (typeof fileOrUrl === 'string') {
          const res = await fetch(fileOrUrl, {
            credentials: 'same-origin',
            headers: { Accept: 'application/pdf' },
          });
          if (!res.ok) throw new Error(`PDF fetch ${res.status}`);
          arrayBuffer = await res.arrayBuffer();
        } else {
          arrayBuffer = await fileOrUrl.arrayBuffer();
        }

        const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
        const page = await pdf.getPage(pageNumber);

        const viewport = page.getViewport({ scale: 1.5 });
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.height = viewport.height;
        canvas.width = viewport.width;

        const renderContext = {
          canvasContext: context,
          viewport,
        };
        await page.render(renderContext).promise;

        const scale = 1.5;
        const [x, y, w, h] = normBbox;

        const cropCanvas = document.createElement('canvas');
        cropCanvas.width = w * scale;
        cropCanvas.height = h * scale;
        const cropCtx = cropCanvas.getContext('2d');

        cropCtx.drawImage(
          canvas,
          x * scale,
          y * scale,
          w * scale,
          h * scale,
          0,
          0,
          w * scale,
          h * scale
        );

        if (isActive) {
          setImageSrc(cropCanvas.toDataURL('image/png'));
        }
      } catch (error) {
        console.error('Screenshot error:', error);
      } finally {
        if (isActive) setLoading(false);
      }
    };

    loadTask();

    return () => {
      isActive = false;
    };
  }, [fileOrUrl, pageNumber, normBbox]);

  return { imageSrc, loading };
};
