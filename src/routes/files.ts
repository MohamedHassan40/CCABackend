import { Router, Request, Response } from 'express';
import multer from 'multer';
import { storageService } from '../core/storage';
import prisma from '../core/db';
import { authMiddleware } from '../middleware/auth';

const router = Router();

// Configure multer for file uploads (memory storage for cloud storage)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
  },
  fileFilter: (req, file, cb) => {
    // Allow images and common document types
    const allowedMimes = [
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type'));
    }
  },
});

// All routes require authentication
router.use(authMiddleware);

// POST /api/files/upload - Upload a file
router.post('/upload', upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.user || !req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    if (!req.file) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }

    const { entityType, entityId, folder } = req.body;

    // Upload file using storage service
    const uploadResult = await storageService.uploadFile(req.file, folder);

    const file = await prisma.file.create({
      data: {
        organizationId: req.org.id,
        userId: req.user.id,
        fileName: uploadResult.fileName,
        originalName: req.file.originalname,
        mimeType: uploadResult.mimeType,
        size: uploadResult.size,
        url: uploadResult.url,
        storageType: uploadResult.storageType,
        storageKey: uploadResult.storageKey,
        entityType: entityType || null,
        entityId: entityId || null,
      },
    });

    res.json(file);
  } catch (error: any) {
    console.error('Error uploading file:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// GET /api/files - List files
router.get('/', async (req: Request, res: Response) => {
  try {
    if (!req.user || !req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { entityType, entityId } = req.query;

    const where: any = {
      organizationId: req.org.id,
    };

    if (entityType) where.entityType = entityType as string;
    if (entityId) where.entityId = entityId as string;

    const files = await prisma.file.findMany({
      where,
      orderBy: {
        createdAt: 'desc',
      },
    });

    res.json(files);
  } catch (error) {
    console.error('Error fetching files:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/files/:id - Delete a file
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    if (!req.user || !req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;

    const file = await prisma.file.findFirst({
      where: {
        id,
        organizationId: req.org.id,
      },
    });

    if (!file) {
      res.status(404).json({ error: 'File not found' });
      return;
    }

    // Delete file from storage
    if (!file.storageKey) {
      res.status(400).json({ error: 'File has no storage key' });
      return;
    }
    await storageService.deleteFile(file.storageKey, file.storageType);

    // Delete database record
    await prisma.file.delete({
      where: { id },
    });

    res.json({ message: 'File deleted successfully' });
  } catch (error) {
    console.error('Error deleting file:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;









