import 'package:flutter/foundation.dart';
import 'package:ntp/ntp.dart';

class SyncService {
  static int _offset = 0;
  static bool _isSynced = false;

  // NTP 서버와 시간 동기화 (오차값 계산)
  static Future<void> syncTime() async {
    if (kIsWeb) {
      print('NTP Sync skipped on Web (UDP not supported in browsers)');
      return;
    }
    try {
      // time.google.com 또는 pool.ntp.org 사용
      DateTime ntpTime = await NTP.now(lookUpAddress: 'time.google.com');
      DateTime localTime = DateTime.now();
      
      _offset = ntpTime.difference(localTime).inMilliseconds;
      _isSynced = true;
      print('NTP Sync Complete. Offset: $_offset ms');
    } catch (e) {
      print('NTP Sync Failed: $e');
      _isSynced = false;
    }
  }

  // 동기화된 현재 시간 반환
  static DateTime get now {
    return DateTime.now().add(Duration(milliseconds: _offset));
  }

  // 특정 시간까지 남은 밀리초 계산 (동기화 시간 기준)
  static int msUntil(DateTime target) {
    return target.difference(now).inMilliseconds;
  }

  static bool get isSynced => _isSynced;
}
