import 'dart:io' show Platform;
import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:device_info_plus/device_info_plus.dart';
import 'package:package_info_plus/package_info_plus.dart';

class SystemMonitorService {
  static final DeviceInfoPlugin _deviceInfo = DeviceInfoPlugin();

  static Future<Map<String, dynamic>> getSystemInfo() async {
    Map<String, dynamic> info = {};

    try {
      // 1. 패키지 정보 (앱 버전)
      PackageInfo packageInfo = await PackageInfo.fromPlatform();
      info['app_version'] = packageInfo.version;
      info['build_number'] = packageInfo.buildNumber;

      // 2. 하드웨어/OS 정보
      if (kIsWeb) {
        WebBrowserInfo webInfo = await _deviceInfo.webBrowserInfo;
        info['os_name'] = 'Web';
        info['browser'] = webInfo.browserName.toString();
        info['platform'] = webInfo.platform;
        info['user_agent'] = webInfo.userAgent;
      } else if (Platform.isAndroid) {
        AndroidDeviceInfo androidInfo = await _deviceInfo.androidInfo;
        info['os_name'] = 'Android';
        info['os_version'] = androidInfo.version.release;
        info['model'] = androidInfo.model;
        info['manufacturer'] = androidInfo.manufacturer;
      } else if (Platform.isWindows) {
        WindowsDeviceInfo windowsInfo = await _deviceInfo.windowsInfo;
        info['os_name'] = 'Windows';
        info['os_version'] = windowsInfo.displayVersion;
        info['computer_name'] = windowsInfo.computerName;
      }

      if (!kIsWeb) {
        info['cpu_count'] = Platform.numberOfProcessors;
      }

    } catch (e) {
      print('Failed to get system info: $e');
    }

    return info;
  }

  static Future<String> getHardwareId() async {
    try {
      if (kIsWeb) {
        WebBrowserInfo webInfo = await _deviceInfo.webBrowserInfo;
        return 'WEB-${webInfo.userAgent.hashCode}';
      } else if (Platform.isWindows) {
        WindowsDeviceInfo windowsInfo = await _deviceInfo.windowsInfo;
        return 'WIN-${windowsInfo.deviceId}';
      } else if (Platform.isAndroid) {
        AndroidDeviceInfo androidInfo = await _deviceInfo.androidInfo;
        return 'AND-${androidInfo.id}';
      }
    } catch (e) {
      print('Failed to get hardware ID: $e');
    }
    return 'UNKNOWN-${DateTime.now().millisecondsSinceEpoch}';
  }
}
