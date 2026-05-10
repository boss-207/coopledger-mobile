import { Alert, Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import {
  CLOUDINARY_CLOUD_NAME,
  CLOUDINARY_UPLOAD_PRESET,
  CLOUDINARY_FOLDER,
} from '../config/cloudinary';

const MAX_ORIGINAL_BYTES = 5 * 1024 * 1024; // 5 Mo

/**
 * Demande les permissions caméra / galerie si besoin.
 */
async function ensureCameraPermission() {
  const { status } = await ImagePicker.requestCameraPermissionsAsync();
  if (status !== 'granted') {
    throw new Error('Permission caméra refusée. Active-la dans les réglages du téléphone.');
  }
}

async function ensureLibraryPermission() {
  const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (status !== 'granted') {
    throw new Error('Permission galerie refusée. Active-la dans les réglages du téléphone.');
  }
}

/**
 * Ouvre le choix Caméra ou Galerie et retourne l’URI de l’image sélectionnée.
 */
export async function selectImage() {
  return new Promise((resolve, reject) => {
    Alert.alert(
      'Justificatif',
      'Choisis une source',
      [
        {
          text: 'Caméra',
          onPress: async () => {
            try {
              await ensureCameraPermission();
              const result = await ImagePicker.launchCameraAsync({
                mediaTypes: ['images'],
                allowsEditing: false,
                quality: 1,
              });
              if (result.canceled || !result.assets?.[0]?.uri) {
                resolve(null);
                return;
              }
              const asset = result.assets[0];
              if (asset.fileSize && asset.fileSize > MAX_ORIGINAL_BYTES) {
                reject(new Error('Fichier trop volumineux (max 5 Mo). Choisis une autre photo.'));
                return;
              }
              resolve(asset.uri);
            } catch (e) {
              reject(e);
            }
          },
        },
        {
          text: 'Galerie',
          onPress: async () => {
            try {
              await ensureLibraryPermission();
              const result = await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ['images'],
                allowsEditing: false,
                quality: 1,
              });
              if (result.canceled || !result.assets?.[0]?.uri) {
                resolve(null);
                return;
              }
              const asset = result.assets[0];
              if (asset.fileSize && asset.fileSize > MAX_ORIGINAL_BYTES) {
                reject(new Error('Fichier trop volumineux (max 5 Mo). Choisis une autre photo.'));
                return;
              }
              resolve(asset.uri);
            } catch (e) {
              reject(e);
            }
          },
        },
        { text: 'Annuler', style: 'cancel', onPress: () => resolve(null) },
      ],
      { cancelable: true }
    );
  });
}

/**
 * Compresse et redimensionne (max ~1200 px de côté, qualité ~70 %).
 */
export async function compressImage(uri) {
  if (!uri) return null;
  const manipulated = await ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width: 1200 } }],
    { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG }
  );
  return manipulated.uri;
}

/**
 * Envoie l’image vers Cloudinary (upload unsigned) et retourne les métadonnées.
 * @param {string} imageUri URI locale (file://)
 * @param {(pct: number) => void} [onProgress] progression 0–100
 */
export async function uploadToCloudinary(imageUri, onProgress) {
  if (!imageUri) throw new Error('Aucune image à envoyer.');

  if (CLOUDINARY_CLOUD_NAME === 'MON_CLOUD_NAME') {
    throw new Error(
      'Configure EXPO_PUBLIC_CLOUDINARY_CLOUD_NAME dans .env ou modifie src/config/cloudinary.js avec ton cloud name.'
    );
  }

  const url = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`;

  const formData = new FormData();
  formData.append('file', {
    uri: imageUri,
    type: 'image/jpeg',
    name: 'justificatif.jpg',
  });
  formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
  formData.append('folder', CLOUDINARY_FOLDER);

  const data = await new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.onload = () => {
      try {
        const json = JSON.parse(xhr.responseText || '{}');
        if (xhr.status >= 200 && xhr.status < 300 && json.secure_url) {
          resolve(json);
        } else {
          reject(new Error(json.error?.message || `Erreur Cloudinary (${xhr.status})`));
        }
      } catch {
        reject(new Error('Réponse Cloudinary invalide.'));
      }
    };
    xhr.onerror = () => reject(new Error('Erreur réseau pendant l’upload. Réessaie.'));
    xhr.ontimeout = () => reject(new Error('Délai dépassé. Vérifie ta connexion.'));
    xhr.timeout = 120000;

    if (xhr.upload && typeof onProgress === 'function') {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && e.total > 0) {
          onProgress(Math.min(100, Math.round((e.loaded / e.total) * 100)));
        }
      };
    }

    xhr.send(formData);
  });

  return {
    url: data.secure_url,
    publicId: data.public_id,
    width: data.width,
    height: data.height,
  };
}

/**
 * Pipeline complet : sélection → compression → upload Cloudinary.
 * @param {number|string} transactionId Identifiant transaction (ex. id chaîne)
 * @param {object} userData Profil Firebase (uid, nom)
 * @param {{ existingUri?: string | null, onProgress?: (n:number)=>void }} [options]
 */
export async function uploadJustificatif(transactionId, userData, options = {}) {
  const { existingUri = null, onProgress } = options;

  let uri = existingUri;
  if (!uri) {
    uri = await selectImage();
    if (!uri) return null;
  }

  const compressed = await compressImage(uri);
  if (!compressed) return null;

  const cloud = await uploadToCloudinary(compressed, onProgress);

  return {
    url: cloud.url,
    publicId: cloud.publicId,
    width: cloud.width,
    height: cloud.height,
    uploadedAt: new Date(),
    uploadedBy: userData?.uid || null,
    uploadedByNom: userData?.nom || 'Membre',
    transactionId: String(transactionId),
  };
}
