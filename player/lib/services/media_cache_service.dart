import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:path_provider/path_provider.dart';
import 'package:path/path.dart' as p;
import 'supabase_service.dart';

class MediaCacheService {
  // 웹에서는 호출되지 않도록 보장
  Future<String> _getAppDirectory() async {
    if (kIsWeb) return '';
    try {
      // Documents(문서) 대신 ApplicationSupport(AppData)를 활용하여 한글 경로 문제 회피
      final supportDir = await getApplicationSupportDirectory();
      return supportDir.path;
    } catch (e) {
      final tempDir = await getTemporaryDirectory();
      return tempDir.path;
    }
  }

  Future<String> get _localPath async {
    if (kIsWeb) return ''; 
    final baseDir = await _getAppDirectory();
    if (baseDir.isEmpty) return '';

    final path = p.join(baseDir, 'media_cache');
    final mediaDir = Directory(path);
    if (!await mediaDir.exists()) {
      await mediaDir.create(recursive: true);
    }
    return mediaDir.path;
  }

  Future<String> getCachedFile(String url, {String? mediaId}) async {
    if (url.isEmpty || kIsWeb) return url;

    try {
      final fileName = p.basename(Uri.parse(url).path);
      final localPath = await _localPath;
      if (localPath.isEmpty) return url;

      final filePath = p.join(localPath, fileName);
      final file = File(filePath);

      // 1. 이미 캐시된 파일이 있는지 확인
      if (await file.exists()) {
        final length = await file.length();
        if (length > 0) {
          return filePath;
        }
        await file.delete(); // 깨진 파일 제거
      }

      // 2. 캐시가 없다면 다운로드 시도
      String downloadUrl = url;
      
      // GCP GCS 경로인 경우 비공개 액세스를 위해 서명된 URL 획득
      if (url.contains('storage.googleapis.com') && mediaId != null) {
        final signedUrl = await SupabaseService().getSignedUrl(mediaId);
        if (signedUrl != null) {
          downloadUrl = signedUrl;
        }
      }

      final response = await http.get(Uri.parse(downloadUrl));
      if (response.statusCode == 200) {
        await file.writeAsBytes(response.bodyBytes);
        return filePath;
      } else {
        print('Download failed with status: ${response.statusCode}');
      }
    } catch (e) {
      print('Download/Cache error: $e');
    }

    return url;
  }

  Future<void> clearCache() async {
    if (kIsWeb) return;
    try {
      final path = await _localPath;
      if (path.isEmpty) return;
      final directory = Directory(path);
      if (await directory.exists()) {
        await directory.delete(recursive: true);
      }
    } catch (e) {
      print('Clear cache error: $e');
    }
  }
}
