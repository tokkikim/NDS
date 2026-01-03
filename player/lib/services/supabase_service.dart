import 'package:supabase_flutter/supabase_flutter.dart';
import '../models/models.dart';

class SupabaseService {
  static const String supabaseUrl = 'https://rhbzfgbiliorttffiovj.supabase.co';
  static const String supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJoYnpmZ2JpbGlvcnR0ZmZpb3ZqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY3NjAyMDYsImV4cCI6MjA4MjMzNjIwNn0.2NOa_vz44VW3LjRwzTJU1G7YyUFiOck2P9St79IUyIw';

  static Future<void> init() async {
    await Supabase.initialize(
      url: supabaseUrl,
      anonKey: supabaseAnonKey,
    );
  }

  final supabase = Supabase.instance.client;
  static final SupabaseService _instance = SupabaseService._internal();
  factory SupabaseService() => _instance;
  SupabaseService._internal();

  // GCS 서명된 URL 획득 (비공개 버킷 접근용)
  Future<String?> getSignedUrl(String mediaId) async {
    try {
      final response = await supabase.functions.invoke(
        'get-gcs-signed-url',
        body: {
          'action': 'download',
          'mediaId': mediaId,
        },
      );
      
      if (response.status == 200) {
        return response.data['signedUrl'] as String;
      }
    } catch (e) {
      print('Failed to get signed URL: $e');
    }
    return null;
  }

  // 기기 정보 조회 (카테고리 및 매체 그룹 설정 포함)
  Future<DeviceModel?> getDevice(String deviceId) async {
    final response = await supabase
        .from('devices')
        .select('*, device_categories(*, media_groups(*))')
        .eq('id', deviceId)
        .maybeSingle();
    
    if (response == null) return null;

    final deviceData = Map<String, dynamic>.from(response);
    final categoryData = deviceData['device_categories'];
    final groupData = categoryData != null ? categoryData['media_groups'] : null;

    // 상속 체계 반영 (기기 -> 카테고리 -> 매체 그룹)
    deviceData['op_start_time'] ??= (categoryData?['op_start_time'] ?? groupData?['op_start_time']);
    deviceData['op_end_time'] ??= (categoryData?['op_end_time'] ?? groupData?['op_end_time']);
    deviceData['total_slots'] = categoryData?['total_slots'] ?? groupData?['total_slots'] ?? 10;
    deviceData['policy_plays'] = categoryData?['plays_per_slot'] ?? groupData?['plays_per_slot'] ?? 100;
    deviceData['slot_duration'] = categoryData?['slot_duration'] ?? groupData?['slot_duration'] ?? 15;

    return DeviceModel.fromJson(deviceData);
  }

  // 하드웨어 식별자(MAC/Serial 등)로 등록된 기기 찾기
  Future<DeviceModel?> getDeviceByHardwareId(String hardwareId) async {
    final response = await supabase
        .from('devices')
        .select('*, device_categories(*, media_groups(*))')
        .eq('hardware_id', hardwareId)
        .maybeSingle();
    
    if (response == null) return null;

    // 기존 getDevice와 동일한 상속 로직은 내부 함수로 분리하는 것이 좋으나 우선 구현
    final deviceData = Map<String, dynamic>.from(response);
    final categoryData = deviceData['device_categories'];
    final groupData = categoryData != null ? categoryData['media_groups'] : null;

    deviceData['op_start_time'] ??= (categoryData?['op_start_time'] ?? groupData?['op_start_time']);
    deviceData['op_end_time'] ??= (categoryData?['op_end_time'] ?? groupData?['op_end_time']);
    deviceData['total_slots'] = categoryData?['total_slots'] ?? groupData?['total_slots'] ?? 10;
    deviceData['policy_plays'] = categoryData?['plays_per_slot'] ?? groupData?['plays_per_slot'] ?? 100;
    deviceData['slot_duration'] = categoryData?['slot_duration'] ?? groupData?['slot_duration'] ?? 15;

    return DeviceModel.fromJson(deviceData);
  }

  // 신규 기기 등록 요청 (최초 1회 또는 상태 갱신)
  Future<void> requestRegistration(String hardwareId, String name, Map<String, dynamic> metadata) async {
    try {
      await supabase.from('devices').upsert({
        'hardware_id': hardwareId,
        'name': name,
        'metadata': metadata,
        'last_seen': DateTime.now().toUtc().toIso8601String(),
      }, onConflict: 'hardware_id');
    } catch (e) {
      print('Registration request failed: $e');
    }
  }

  // 카테고리(구분) 조회
  Future<Map<String, dynamic>?> getCategory(String categoryId) async {
    return await supabase
        .from('device_categories')
        .select()
        .eq('id', categoryId)
        .maybeSingle();
  }

  // 매체 그룹 조회
  Future<Map<String, dynamic>?> getMediaGroup(String groupId) async {
    return await supabase
        .from('media_groups')
        .select()
        .eq('id', groupId)
        .maybeSingle();
  }

  // 스케줄 목록 조회 (시간대 정보 포함)
  Future<List<ScheduleModel>> getSchedules(String deviceId) async {
    try {
      final response = await supabase
          .from('schedules')
          .select('*, medias(*), time_slots(slot_start, slot_end)')
          .eq('device_id', deviceId)
          .eq('is_active', true) // 활성 스케줄만
          .order('slot_no');
      
      return (response as List).map((json) {
        final Map<String, dynamic> data = Map.from(json);
        if (json['time_slots'] != null && (json['time_slots'] as List).isNotEmpty) {
          // 배열로 올 경우 첫 번째 값 사용 (다중 시간대 지원 시 확장 필요)
          data['slot_start'] = json['time_slots'][0]['slot_start'];
          data['slot_end'] = json['time_slots'][0]['slot_end'];
        }
        return ScheduleModel.fromJson(data);
      }).toList();
    } catch (e) {
      print('Failed to get schedules: $e');
      return [];
    }
  }

  // 상태 보고 (Heartbeat) - 하드웨어 정보 포함
  Future<void> updateStatus(String deviceId, String status, {Map<String, dynamic>? metadata}) async {
    try {
      await supabase.from('devices').update({
        'status': status,
        'last_seen': DateTime.now().toUtc().toIso8601String(),
        'metadata': metadata ?? {},
      }).eq('id', deviceId);
    } catch (e) {
      print('Status update failed: $e');
    }
  }

  // 재생 로그 기록 (Proof-of-Play)
  Future<void> logPlayback(String deviceId, String mediaId, int actualDurationMs) async {
    try {
      await supabase.from('playback_logs').insert({
        'device_id': deviceId,
        'media_id': mediaId,
        'played_at': DateTime.now().toUtc().toIso8601String(),
        'duration_actual': actualDurationMs,
      });
    } catch (e) {
      print('Logging failed: $e');
    }
  }

  // Realtime: 특정 기기의 스케줄 변경 구독
  Stream<List<ScheduleModel>> subscribeToSchedules(String deviceId) {
    return supabase
        .from('schedules')
        .stream(primaryKey: ['id'])
        .eq('device_id', deviceId)
        .asyncMap((event) async {
          // 스케줄 데이터가 변경되면 상세 정보(미디어 등)를 포함하여 다시 가져옴
          return await getSchedules(deviceId);
        });
  }

  // Realtime: 특정 기기 데이터 변경 구독
  Stream<Map<String, dynamic>> subscribeToDevice(String deviceId) {
    return supabase
        .from('devices')
        .stream(primaryKey: ['id'])
        .eq('id', deviceId)
        .map((list) => list.first);
  }
}
