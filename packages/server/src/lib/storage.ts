import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { GetObjectCommand, PutObjectCommand, DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';

type StorageBackend = 'local' | 's3';

type StoredFile = {
  filePath: string;
  storageKey: string;
};

const LOCAL_UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads');
const STORAGE_BACKEND: StorageBackend = (String(process.env.STORAGE_BACKEND || 'local').toLowerCase() === 's3')
  ? 's3'
  : 'local';

const S3_BUCKET = process.env.S3_BUCKET || '';
const S3_REGION = process.env.S3_REGION || 'us-east-1';
const S3_ENDPOINT = process.env.S3_ENDPOINT || '';
const S3_FORCE_PATH_STYLE = String(process.env.S3_FORCE_PATH_STYLE || '').toLowerCase() === 'true';
const S3_ACCESS_KEY_ID = process.env.S3_ACCESS_KEY_ID || '';
const S3_SECRET_ACCESS_KEY = process.env.S3_SECRET_ACCESS_KEY || '';

let s3Client: S3Client | null = null;

function ensureLocalDir(folder: string) {
  const dir = path.join(LOCAL_UPLOAD_DIR, folder);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function sanitizeExt(originalName: string) {
  const ext = path.extname(originalName).toLowerCase();
  return ext && ext.length <= 10 ? ext : '';
}

function uniqueKey(folder: string, originalName: string): string {
  const ext = sanitizeExt(originalName);
  return `${folder}/${Date.now()}-${randomUUID()}${ext}`;
}

function getS3Client() {
  if (s3Client) return s3Client;
  if (!S3_BUCKET) {
    throw new Error('S3_BUCKET is required when STORAGE_BACKEND=s3');
  }
  const hasStaticCredentials = !!S3_ACCESS_KEY_ID && !!S3_SECRET_ACCESS_KEY;
  s3Client = new S3Client({
    region: S3_REGION,
    endpoint: S3_ENDPOINT || undefined,
    forcePathStyle: S3_FORCE_PATH_STYLE,
    ...(hasStaticCredentials
      ? {
          credentials: {
            accessKeyId: S3_ACCESS_KEY_ID,
            secretAccessKey: S3_SECRET_ACCESS_KEY,
          },
        }
      : {}),
  });
  return s3Client;
}

export function getStorageBackend(): StorageBackend {
  return STORAGE_BACKEND;
}

export async function saveUploadedBuffer(
  buffer: Buffer,
  folder: string,
  originalName: string,
  contentType?: string
): Promise<StoredFile> {
  const key = uniqueKey(folder, originalName);
  if (STORAGE_BACKEND === 's3') {
    const s3 = getS3Client();
    await s3.send(
      new PutObjectCommand({
        Bucket: S3_BUCKET,
        Key: key,
        Body: buffer,
        ContentType: contentType || 'application/octet-stream',
      })
    );
    return {
      filePath: `/api/files/${encodeURIComponent(key)}`,
      storageKey: key,
    };
  }

  const dir = ensureLocalDir(folder);
  const filename = path.basename(key);
  const absolute = path.join(dir, filename);
  fs.writeFileSync(absolute, Uint8Array.from(buffer));
  return {
    filePath: `/uploads/${folder}/${filename}`,
    storageKey: `${folder}/${filename}`,
  };
}

export async function deleteStoredFile(filePath: string | null | undefined): Promise<void> {
  if (!filePath) return;

  if (filePath.startsWith('/api/files/')) {
    if (STORAGE_BACKEND !== 's3') return;
    const key = decodeURIComponent(filePath.replace('/api/files/', ''));
    const s3 = getS3Client();
    await s3.send(new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: key }));
    return;
  }

  if (filePath.startsWith('/uploads/')) {
    const localPath = path.join(LOCAL_UPLOAD_DIR, filePath.replace('/uploads/', ''));
    if (fs.existsSync(localPath)) fs.unlinkSync(localPath);
  }
}

export async function readStoredFile(storageKey: string): Promise<{ body: Readable; contentType: string }> {
  if (STORAGE_BACKEND !== 's3') {
    const localPath = path.join(LOCAL_UPLOAD_DIR, storageKey);
    if (!fs.existsSync(localPath)) throw new Error('File not found');
    return {
      body: fs.createReadStream(localPath),
      contentType: 'application/octet-stream',
    };
  }

  const s3 = getS3Client();
  const result = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: storageKey }));
  if (!result.Body || !(result.Body instanceof Readable)) {
    throw new Error('File body unavailable');
  }
  return {
    body: result.Body,
    contentType: result.ContentType || 'application/octet-stream',
  };
}
