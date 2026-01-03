import 'package:intl/intl.dart';

class TimeUtils {
  static bool isOperating(String startTime, String endTime) {
    if (startTime.isEmpty || endTime.isEmpty) return true;

    final now = DateTime.now();
    final format = DateFormat("HH:mm:ss");
    
    try {
      // 시간/분만 있는 경우 대응 (예: 08:00 -> 08:00:00)
      String startStr = startTime.split(':').length == 2 ? "$startTime:00" : startTime;
      String endStr = endTime.split(':').length == 2 ? "$endTime:00" : endTime;

      final start = format.parse(startStr);
      final end = format.parse(endStr);
      final nowTime = format.parse(DateFormat("HH:mm:ss").format(now));

      if (end.isBefore(start)) {
        // 자정을 걸치는 경우 (예: 22:00 ~ 08:00)
        // nowTime >= start OR nowTime <= end
        return !nowTime.isBefore(start) || !nowTime.isAfter(end);
      } else {
        // 일반적인 경우 (예: 08:00 ~ 22:00)
        // nowTime >= start AND nowTime <= end
        return !nowTime.isBefore(start) && !nowTime.isAfter(end);
      }
    } catch (e) {
      print('Time parsing error: $e');
      return true; 
    }
  }

  static int parseTimeToSeconds(String time) {
    final parts = time.split(':');
    if (parts.length < 2) return 0;
    final h = int.parse(parts[0]);
    final m = int.parse(parts[1]);
    final s = parts.length > 2 ? int.parse(parts[2]) : 0;
    return h * 3600 + m * 60 + s;
  }
  static bool isTimeInRange(String targetTime, String startTime, String endTime) {
    if (startTime.isEmpty || endTime.isEmpty) return true;
    
    final format = DateFormat("HH:mm:ss");
    try {
      String targetStr = targetTime.split(':').length == 2 ? "$targetTime:00" : targetTime;
      String startStr = startTime.split(':').length == 2 ? "$startTime:00" : startTime;
      String endStr = endTime.split(':').length == 2 ? "$endTime:00" : endTime;

      final target = format.parse(targetStr);
      final start = format.parse(startStr);
      final end = format.parse(endStr);

      if (end.isBefore(start)) {
        return !target.isBefore(start) || !target.isAfter(end);
      } else {
        return !target.isBefore(start) && !target.isAfter(end);
      }
    } catch (e) {
      return true;
    }
  }

  static String secondsToTimeString(int totalSeconds) {
    int h = (totalSeconds / 3600).floor() % 24;
    int m = (totalSeconds / 60).floor() % 60;
    int s = totalSeconds % 60;
    return "${h.toString().padLeft(2, '0')}:${m.toString().padLeft(2, '0')}:${s.toString().padLeft(2, '0')}";
  }
}
