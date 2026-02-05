// Storage service abstraction
// Supports local storage, S3, and Cloudinary

import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

export interface StorageConfig {
  type: 'local' | 's3' | 'cloudinary';
  bucket?: string;
  region?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  cloudName?: string;
  apiKey?: string;
  apiSecret?: string;
  uploadDir?: string;
}

export interface UploadResult {
  url: string;
  storageType: string;
  storageKey: string;
  fileName: string;
  size: number;
  mimeType: string;
}

class StorageService {
  private config: StorageConfig;

  constructor(config: StorageConfig) {
    this.config = config;
  }

  /**
   * Upload a file
   */
  async uploadFile(
    file: Express.Multer.File,
    folder?: string
  ): Promise<UploadResult> {
    switch (this.config.type) {
      case 's3':
        return this.uploadToS3(file, folder);
      case 'cloudinary':
        return this.uploadToCloudinary(file, folder);
      case 'local':
      default:
        return this.uploadToLocal(file, folder);
    }
  }

  /**
   * Delete a file
   */
  async deleteFile(storageKey: string, storageType: string): Promise<void> {
    switch (storageType) {
      case 's3':
        return this.deleteFromS3(storageKey);
      case 'cloudinary':
        return this.deleteFromCloudinary(storageKey);
      case 'local':
      default:
        return this.deleteFromLocal(storageKey);
    }
  }

  /**
   * Get file URL
   */
  getFileUrl(storageKey: string, storageType: string): string {
    switch (storageType) {
      case 's3':
        return `https://${this.config.bucket}.s3.${this.config.region || 'us-east-1'}.amazonaws.com/${storageKey}`;
      case 'cloudinary':
        return `https://res.cloudinary.com/${this.config.cloudName}/image/upload/${storageKey}`;
      case 'local':
      default:
        const baseUrl = process.env.API_URL || process.env.FRONTEND_URL || 'http://localhost:3001';
        return `${baseUrl}/uploads/${storageKey}`;
    }
  }

  // Local storage implementation
  private async uploadToLocal(file: Express.Multer.File, folder?: string): Promise<UploadResult> {
    const uploadDir = this.config.uploadDir || './uploads';
    const targetDir = folder ? path.join(uploadDir, folder) : uploadDir;
    
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const uniqueName = `${uuidv4()}${path.extname(file.originalname)}`;
    const filePath = path.join(targetDir, uniqueName);

    fs.writeFileSync(filePath, file.buffer);

    return {
      url: this.getFileUrl(uniqueName, 'local'),
      storageType: 'local',
      storageKey: uniqueName,
      fileName: uniqueName,
      size: file.size,
      mimeType: file.mimetype,
    };
  }

  private async deleteFromLocal(storageKey: string): Promise<void> {
    const uploadDir = this.config.uploadDir || './uploads';
    const filePath = path.join(uploadDir, storageKey);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }

  // S3 implementation (placeholder - requires aws-sdk)
  private async uploadToS3(file: Express.Multer.File, folder?: string): Promise<UploadResult> {
    // This would require aws-sdk package
    // For now, return error if S3 is configured but not implemented
    throw new Error('S3 storage not yet implemented. Install aws-sdk and implement uploadToS3');
  }

  private async deleteFromS3(storageKey: string): Promise<void> {
    throw new Error('S3 storage not yet implemented');
  }

  // Cloudinary implementation (placeholder - requires cloudinary package)
  private async uploadToCloudinary(file: Express.Multer.File, folder?: string): Promise<UploadResult> {
    // This would require cloudinary package
    // For now, return error if Cloudinary is configured but not implemented
    throw new Error('Cloudinary storage not yet implemented. Install cloudinary and implement uploadToCloudinary');
  }

  private async deleteFromCloudinary(storageKey: string): Promise<void> {
    throw new Error('Cloudinary storage not yet implemented');
  }
}

// Create storage service instance
const storageType = (process.env.STORAGE_TYPE || 'local') as 'local' | 's3' | 'cloudinary';

export const storageService = new StorageService({
  type: storageType,
  bucket: process.env.S3_BUCKET,
  region: process.env.S3_REGION,
  accessKeyId: process.env.S3_ACCESS_KEY_ID,
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
  cloudName: process.env.CLOUDINARY_CLOUD_NAME,
  apiKey: process.env.CLOUDINARY_API_KEY,
  apiSecret: process.env.CLOUDINARY_API_SECRET,
  uploadDir: process.env.UPLOAD_DIR || './uploads',
});






