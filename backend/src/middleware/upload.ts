import { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { isCloudinaryConfigured } from '../config/cloudinary';

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB

/**
 * Files are buffered in memory and streamed to Cloudinary by the route —
 * nothing ever touches the local filesystem.
 */
export const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: MAX_UPLOAD_BYTES },
});

/** Fail fast with a readable message when the Cloudinary credentials are missing. */
export function requireCloudinary(_req: Request, res: Response, next: NextFunction): void {
  if (!isCloudinaryConfigured()) {
    res.status(503).json({ message: 'File storage is not configured. Set the CLOUDINARY_* environment variables.' });
    return;
  }
  next();
}

/** Turns multer's own errors into JSON instead of Express' default HTML page. */
export function uploadErrorHandler(err: unknown, _req: Request, res: Response, next: NextFunction): void {
  if (err instanceof multer.MulterError) {
    const tooLarge = err.code === 'LIMIT_FILE_SIZE';
    res.status(tooLarge ? 413 : 400).json({
      message: tooLarge ? `File is too large (max ${MAX_UPLOAD_BYTES / 1024 / 1024} MB)` : err.message,
    });
    return;
  }
  next(err);
}
