import { Router, Request, Response } from 'express';
import prisma from '../../core/db';
import { authMiddleware } from '../../middleware/auth';
import { requireModuleEnabled } from '../../middleware/modules';
import { requirePermission } from '../../middleware/permissions';
import { moduleRegistry } from '../../core/modules/registry';
import type { ModuleManifest } from '@cloud-org/shared';

const router = Router();

// Module manifest
export const documentsManifest: ModuleManifest = {
  key: 'documents',
  name: 'Document Management',
  icon: 'folder',
  sidebarItems: [
    {
      path: '/documents/library',
      label: 'Library',
      permission: 'documents.view',
    },
    {
      path: '/documents/folders',
      label: 'Folders',
      permission: 'documents.folders.view',
    },
    {
      path: '/documents/shared',
      label: 'Shared with Me',
      permission: 'documents.view',
    },
    {
      path: '/documents/categories',
      label: 'Categories',
      permission: 'documents.categories.view',
    },
  ],
  dashboardWidgets: [
    {
      id: 'document-count',
      title: 'Total Documents',
      description: 'Number of documents in library',
      apiPath: '/api/documents/widgets/count',
      permission: 'documents.view',
    },
    {
      id: 'recent-documents',
      title: 'Recent Documents',
      description: 'Recently accessed documents',
      apiPath: '/api/documents/widgets/recent',
      permission: 'documents.view',
    },
  ],
};

// Register module
export function registerDocumentsModule(routerInstance: Router): void {
  routerInstance.use('/api/documents', authMiddleware, requireModuleEnabled('documents'), router);

  moduleRegistry.register({
    key: 'documents',
    manifest: documentsManifest,
    registerRoutes: () => {},
  });
}

// ============================================
// DOCUMENTS
// ============================================

// GET /api/documents - List documents
router.get('/', requirePermission('documents.view'), async (req: Request, res: Response) => {
  try {
    if (!req.org || !req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { folderId, status, search, categoryId, tags, sharedWithMe } = req.query;

    const where: any = {
      orgId: req.org.id,
    };

    if (sharedWithMe === 'true' && req.user?.id) {
      where.shares = {
        some: {
          OR: [
            { sharedWithId: req.user.id },
            { sharedWithEmail: req.user.email },
          ],
        },
      };
    }

    if (folderId) {
      where.folderId = folderId as string;
    } else if (folderId === 'null' || folderId === '') {
      where.folderId = null;
    }

    if (status) {
      where.status = status as string;
    }

    if (search) {
      where.OR = [
        { name: { contains: search as string, mode: 'insensitive' } },
        { description: { contains: search as string, mode: 'insensitive' } },
      ];
    }

    if (categoryId) {
      where.categories = {
        some: {
          categoryId: categoryId as string,
        },
      };
    }

    if (tags) {
      const tagArray = (tags as string).split(',');
      where.tags = {
        hasEvery: tagArray,
      };
    }

    const documents = await prisma.document.findMany({
      where,
      include: {
        folder: true,
        createdBy: {
          select: { id: true, name: true, email: true },
        },
        updatedBy: {
          select: { id: true, name: true, email: true },
        },
        files: {
          orderBy: { createdAt: 'desc' },
          take: 1, // Latest file
        },
        categories: {
          include: {
            category: true,
          },
        },
        shares: {
          where: {
            sharedWithId: req.user.id,
          },
        },
      },
      orderBy: {
        updatedAt: 'desc',
      },
    });

    res.json(documents);
  } catch (error: any) {
    console.error('Error fetching documents:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// GET /api/documents/:id - Get document details
router.get('/:id', requirePermission('documents.view'), async (req: Request, res: Response) => {
  try {
    if (!req.org || !req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;

    const document = await prisma.document.findFirst({
      where: {
        id,
        orgId: req.org.id,
        OR: [
          { isPublic: true },
          { createdById: req.user.id },
          {
            shares: {
              some: {
                OR: [
                  { sharedWithId: req.user.id },
                  { sharedWithEmail: req.user.email },
                ],
              },
            },
          },
        ],
      },
      include: {
        folder: true,
        createdBy: {
          select: { id: true, name: true, email: true },
        },
        updatedBy: {
          select: { id: true, name: true, email: true },
        },
        files: {
          orderBy: { createdAt: 'desc' },
        },
        categories: {
          include: {
            category: true,
          },
        },
        shares: {
          include: {
            sharedWith: {
              select: { id: true, name: true, email: true },
            },
            sharedBy: {
              select: { id: true, name: true, email: true },
            },
          },
        },
      },
    });

    if (!document) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    res.json(document);
  } catch (error: any) {
    console.error('Error fetching document:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// POST /api/documents - Create document
router.post('/', requirePermission('documents.create'), async (req: Request, res: Response) => {
  try {
    if (!req.org || !req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { name, description, folderId, tags, isPublic, status, fileIds, categoryIds } = req.body;

    if (!name) {
      res.status(400).json({ error: 'Name is required' });
      return;
    }

    const document = await prisma.document.create({
      data: {
        orgId: req.org.id,
        name,
        description: description || null,
        folderId: folderId || null,
        tags: tags || [],
        isPublic: isPublic || false,
        status: status || 'active',
        createdById: req.user.id,
        updatedById: req.user.id,
        files: fileIds ? {
          connect: fileIds.map((id: string) => ({ id })),
        } : undefined,
        categories: categoryIds ? {
          create: categoryIds.map((categoryId: string) => ({
            category: { connect: { id: categoryId } },
          })),
        } : undefined,
      },
      include: {
        folder: true,
        createdBy: {
          select: { id: true, name: true, email: true },
        },
        files: true,
        categories: {
          include: {
            category: true,
          },
        },
      },
    });

    res.status(201).json(document);
  } catch (error: any) {
    console.error('Error creating document:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// PUT /api/documents/:id - Update document
router.put('/:id', requirePermission('documents.edit'), async (req: Request, res: Response) => {
  try {
    if (!req.org || !req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;
    const { name, description, folderId, tags, isPublic, status, fileIds, categoryIds } = req.body;

    const document = await prisma.document.findFirst({
      where: {
        id,
        orgId: req.org.id,
      },
    });

    if (!document) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    const updateData: any = {
      updatedById: req.user.id,
    };

    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (folderId !== undefined) updateData.folderId = folderId;
    if (tags !== undefined) updateData.tags = tags;
    if (isPublic !== undefined) updateData.isPublic = isPublic;
    if (status !== undefined) updateData.status = status;

    if (fileIds !== undefined) {
      updateData.files = {
        set: fileIds.map((id: string) => ({ id })),
      };
    }

    if (categoryIds !== undefined) {
      // Delete existing categories
      await prisma.documentCategoryDocument.deleteMany({
        where: { documentId: id },
      });
      // Add new categories
      if (categoryIds.length > 0) {
        updateData.categories = {
          create: categoryIds.map((categoryId: string) => ({
            category: { connect: { id: categoryId } },
          })),
        };
      }
    }

    const updated = await prisma.document.update({
      where: { id },
      data: updateData,
      include: {
        folder: true,
        createdBy: {
          select: { id: true, name: true, email: true },
        },
        updatedBy: {
          select: { id: true, name: true, email: true },
        },
        files: true,
        categories: {
          include: {
            category: true,
          },
        },
      },
    });

    res.json(updated);
  } catch (error: any) {
    console.error('Error updating document:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// DELETE /api/documents/:id - Delete document
router.delete('/:id', requirePermission('documents.delete'), async (req: Request, res: Response) => {
  try {
    if (!req.org || !req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;

    const document = await prisma.document.findFirst({
      where: {
        id,
        orgId: req.org.id,
      },
    });

    if (!document) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    await prisma.document.delete({
      where: { id },
    });

    res.json({ message: 'Document deleted successfully' });
  } catch (error: any) {
    console.error('Error deleting document:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// ============================================
// FOLDERS
// ============================================

// GET /api/documents/folders - List folders
router.get('/folders', requirePermission('documents.folders.view'), async (req: Request, res: Response) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { parentId } = req.query;

    const where: any = {
      orgId: req.org.id,
    };

    if (parentId) {
      where.parentId = parentId as string;
    } else if (parentId === 'null' || parentId === '') {
      where.parentId = null;
    }

    const folders = await prisma.documentFolder.findMany({
      where,
      include: {
        parent: true,
        children: true,
        createdBy: {
          select: { id: true, name: true, email: true },
        },
        _count: {
          select: {
            documents: true,
            files: true,
            children: true,
          },
        },
      },
      orderBy: {
        name: 'asc',
      },
    });

    res.json(folders);
  } catch (error: any) {
    console.error('Error fetching folders:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// POST /api/documents/folders - Create folder
router.post('/folders', requirePermission('documents.folders.create'), async (req: Request, res: Response) => {
  try {
    if (!req.org || !req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { name, description, parentId, color } = req.body;

    if (!name) {
      res.status(400).json({ error: 'Name is required' });
      return;
    }

    const folder = await prisma.documentFolder.create({
      data: {
        orgId: req.org.id,
        name,
        description: description || null,
        parentId: parentId || null,
        color: color || null,
        createdById: req.user.id,
      },
      include: {
        parent: true,
        createdBy: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    res.status(201).json(folder);
  } catch (error: any) {
    console.error('Error creating folder:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// PUT /api/documents/folders/:id - Update folder
router.put('/folders/:id', requirePermission('documents.folders.edit'), async (req: Request, res: Response) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;
    const { name, description, parentId, color } = req.body;

    const folder = await prisma.documentFolder.findFirst({
      where: {
        id,
        orgId: req.org.id,
      },
    });

    if (!folder) {
      res.status(404).json({ error: 'Folder not found' });
      return;
    }

    const updateData: any = {};
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (parentId !== undefined) updateData.parentId = parentId;
    if (color !== undefined) updateData.color = color;

    const updated = await prisma.documentFolder.update({
      where: { id },
      data: updateData,
      include: {
        parent: true,
        createdBy: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    res.json(updated);
  } catch (error: any) {
    console.error('Error updating folder:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// DELETE /api/documents/folders/:id - Delete folder
router.delete('/folders/:id', requirePermission('documents.folders.delete'), async (req: Request, res: Response) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;

    const folder = await prisma.documentFolder.findFirst({
      where: {
        id,
        orgId: req.org.id,
      },
      include: {
        _count: {
          select: {
            documents: true,
            files: true,
            children: true,
          },
        },
      },
    });

    if (!folder) {
      res.status(404).json({ error: 'Folder not found' });
      return;
    }

    if (folder._count.documents > 0 || folder._count.files > 0 || folder._count.children > 0) {
      res.status(400).json({ error: 'Cannot delete folder with documents, files, or subfolders' });
      return;
    }

    await prisma.documentFolder.delete({
      where: { id },
    });

    res.json({ message: 'Folder deleted successfully' });
  } catch (error: any) {
    console.error('Error deleting folder:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// ============================================
// SHARING
// ============================================

// POST /api/documents/:id/share - Share document
router.post('/:id/share', requirePermission('documents.share'), async (req: Request, res: Response) => {
  try {
    if (!req.org || !req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;
    const { sharedWithId, sharedWithEmail, permission, expiresAt } = req.body;

    if (!sharedWithId && !sharedWithEmail) {
      res.status(400).json({ error: 'sharedWithId or sharedWithEmail is required' });
      return;
    }

    const document = await prisma.document.findFirst({
      where: {
        id,
        orgId: req.org.id,
      },
    });

    if (!document) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    const share = await prisma.documentShare.create({
      data: {
        documentId: id,
        sharedWithId: sharedWithId || null,
        sharedWithEmail: sharedWithEmail || null,
        permission: permission || 'view',
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        sharedById: req.user.id,
      },
      include: {
        sharedWith: {
          select: { id: true, name: true, email: true },
        },
        sharedBy: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    res.status(201).json(share);
  } catch (error: any) {
    console.error('Error sharing document:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// DELETE /api/documents/:id/share/:shareId - Unshare document
router.delete('/:id/share/:shareId', requirePermission('documents.share'), async (req: Request, res: Response) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id, shareId } = req.params;

    const share = await prisma.documentShare.findFirst({
      where: {
        id: shareId,
        documentId: id,
        document: {
          orgId: req.org.id,
        },
      },
    });

    if (!share) {
      res.status(404).json({ error: 'Share not found' });
      return;
    }

    await prisma.documentShare.delete({
      where: { id: shareId },
    });

    res.json({ message: 'Share removed successfully' });
  } catch (error: any) {
    console.error('Error unsharing document:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// ============================================
// CATEGORIES
// ============================================

// GET /api/documents/categories - List categories
router.get('/categories', requirePermission('documents.categories.view'), async (req: Request, res: Response) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const categories = await prisma.documentCategory.findMany({
      where: {
        orgId: req.org.id,
      },
      include: {
        _count: {
          select: {
            documents: true,
          },
        },
      },
      orderBy: {
        name: 'asc',
      },
    });

    res.json(categories);
  } catch (error: any) {
    console.error('Error fetching categories:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// POST /api/documents/categories - Create category
router.post('/categories', requirePermission('documents.categories.create'), async (req: Request, res: Response) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { name, description, color } = req.body;

    if (!name) {
      res.status(400).json({ error: 'Name is required' });
      return;
    }

    const category = await prisma.documentCategory.create({
      data: {
        orgId: req.org.id,
        name,
        description: description || null,
        color: color || null,
      },
    });

    res.status(201).json(category);
  } catch (error: any) {
    console.error('Error creating category:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// PUT /api/documents/categories/:id - Update category
router.put('/categories/:id', requirePermission('documents.categories.edit'), async (req: Request, res: Response) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;
    const { name, description, color } = req.body;

    const category = await prisma.documentCategory.findFirst({
      where: {
        id,
        orgId: req.org.id,
      },
    });

    if (!category) {
      res.status(404).json({ error: 'Category not found' });
      return;
    }

    const updateData: any = {};
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (color !== undefined) updateData.color = color;

    const updated = await prisma.documentCategory.update({
      where: { id },
      data: updateData,
    });

    res.json(updated);
  } catch (error: any) {
    console.error('Error updating category:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// DELETE /api/documents/categories/:id - Delete category
router.delete('/categories/:id', requirePermission('documents.categories.delete'), async (req: Request, res: Response) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;

    await prisma.documentCategory.delete({
      where: { id },
    });

    res.json({ message: 'Category deleted successfully' });
  } catch (error: any) {
    console.error('Error deleting category:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// ============================================
// WIDGETS
// ============================================

// GET /api/documents/widgets/count - Document count widget
router.get('/widgets/count', requirePermission('documents.view'), async (req: Request, res: Response) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const count = await prisma.document.count({
      where: {
        orgId: req.org.id,
        status: 'active',
      },
    });

    res.json({ count });
  } catch (error: any) {
    console.error('Error fetching document count:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// GET /api/documents/widgets/recent - Recent documents widget
router.get('/widgets/recent', requirePermission('documents.view'), async (req: Request, res: Response) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const documents = await prisma.document.findMany({
      where: {
        orgId: req.org.id,
        status: 'active',
      },
      include: {
        createdBy: {
          select: { id: true, name: true, email: true },
        },
        files: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
      orderBy: {
        updatedAt: 'desc',
      },
      take: 5,
    });

    res.json({ documents });
  } catch (error: any) {
    console.error('Error fetching recent documents:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

