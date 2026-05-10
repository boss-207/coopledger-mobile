/**
 * Remplace MON_CLOUD_NAME par ton vrai cloud name Cloudinary
 * (Dashboard → Account → API Keys / Cloud name).
 */
export const CLOUDINARY_CLOUD_NAME =
  process.env.EXPO_PUBLIC_CLOUDINARY_CLOUD_NAME || 'MON_CLOUD_NAME';

export const CLOUDINARY_UPLOAD_PRESET = 'coopledger_unsigned';

export const CLOUDINARY_FOLDER = 'justificatifs';
