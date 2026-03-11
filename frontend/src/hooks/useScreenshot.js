import { useState, useEffect } from 'react';
import { pdfjs } from 'react-pdf';

export const useScreenshot = (file, pageNumber, bbox) => {
  const [imageSrc, setImageSrc] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!file || !bbox || !pageNumber) return;

    let isActive = true;
    const loadTask = async () => {
      setLoading(true);
      try {
        // Load PDF
        // Convert File object to ArrayBuffer for PDF.js
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjs.getDocument(arrayBuffer).promise;
        const page = await pdf.getPage(pageNumber);
        
        const viewport = page.getViewport({ scale: 1.5 }); // High res for screenshot
        // BBox: [left, top, width, height] (PDF coordinates, likely unscaled or user needs to handle scale)
        // Assuming bbox is [x, y, w, h] in viewport coordinates of the main viewer? 
        // Need to relate coordinates. For now, assume bbox is roughly correct for scale 1.0 or normalized.
        // If bbox comes from a scale=1.2 viewer, and we render at 1.5, we need to adjust.
        // Let's assume passed bbox is proportional or relative to unscaled PDF point units.
        
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.height = viewport.height;
        canvas.width = viewport.width;

        const renderContext = {
          canvasContext: context,
          viewport: viewport
        };
        await page.render(renderContext).promise;

        // Crop
        // If bbox is [x, y, w, h] in PDF Point units:
        // x * scale, y * scale, w * scale, h * scale
        const scale = 1.5; 
        const [x, y, w, h] = bbox;
        
        // Create a new canvas for the cropped image
        const cropCanvas = document.createElement('canvas');
        cropCanvas.width = w * scale;
        cropCanvas.height = h * scale;
        const cropCtx = cropCanvas.getContext('2d');
        
        cropCtx.drawImage(
            canvas, 
            x * scale, y * scale, w * scale, h * scale,
            0, 0, w * scale, h * scale
        );

        if (isActive) {
            setImageSrc(cropCanvas.toDataURL('image/png'));
        }
      } catch (error) {
        console.error("Screenshot error:", error);
      } finally {
        if (isActive) setLoading(false);
      }
    };

    loadTask();

    return () => { isActive = false; };
  }, [file, pageNumber, bbox]); // deep compare bbox if array

  return { imageSrc, loading };
};