import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter/foundation.dart'; // debugPrint를 위해 추가
import 'services/supabase_service.dart';
import 'services/sync_service.dart';
import 'services/system_monitor_service.dart';
import 'models/models.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'screens/player_screen.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  
  // 전체 화면 모드
  SystemChrome.setEnabledSystemUIMode(SystemUiMode.immersiveSticky);
  
  await SupabaseService.init();
  await SyncService.syncTime(); // NTP 동기화 추가
  
  runApp(const NDSPlayerApp());
}

class NDSPlayerApp extends StatelessWidget {
  const NDSPlayerApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'NDS Player',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        brightness: Brightness.dark,
        scaffoldBackgroundColor: Colors.black,
      ),
      home: const PlayerHome(),
    );
  }
}

class PlayerHome extends StatefulWidget {
  const PlayerHome({super.key});

  @override
  State<PlayerHome> createState() => _PlayerHomeState();
}

class _PlayerHomeState extends State<PlayerHome> {
  final SupabaseService _supabase = SupabaseService();
  bool _isLoading = true;
  DeviceModel? _device;
  List<ScheduleModel> _schedules = [];
  String? _error;
  Timer? _heartbeatTimer;
  Timer? _authCheckTimer;
  String? _hardwareId;
  bool _showInfoOverlay = false;
  Timer? _overlayTimer;
  StreamSubscription? _deviceSubscription;
  StreamSubscription? _schedulesSubscription;

  @override
  void initState() {
    super.initState();
    _initPlayer();
  }

  @override
  void dispose() {
    _heartbeatTimer?.cancel();
    _authCheckTimer?.cancel();
    _overlayTimer?.cancel();
    _deviceSubscription?.cancel();
    _schedulesSubscription?.cancel();
    super.dispose();
  }

  Future<void> _initPlayer() async {
    try {
      setState(() => _isLoading = true);
      
      _hardwareId = await SystemMonitorService.getHardwareId();
      
      final prefs = await SharedPreferences.getInstance();
      String? savedDeviceId = prefs.getString('mapped_device_id');

      if (savedDeviceId != null) {
        final success = await _loadDeviceData(savedDeviceId);
        if (success) return;
        // 로드 실패 시 (예: 기기 삭제됨 또는 승인 취소됨) 저장된 ID 삭제
        await prefs.remove('mapped_device_id');
      }

      // hardware_id로 DB 조회
      final deviceByHw = await _supabase.getDeviceByHardwareId(_hardwareId!);
      
      if (deviceByHw != null && deviceByHw.categoryId != null) {
        // 승인된 기기 발견
        await prefs.setString('mapped_device_id', deviceByHw.id);
        await _loadDeviceData(deviceByHw.id);
      } else {
        // 미등록 또는 미승인 기기
        final systemInfo = await SystemMonitorService.getSystemInfo();
        // 등록 요청 (이미 있으면 무시되거나 상태 업데이트)
        await _supabase.requestRegistration(_hardwareId!, '신규 기기-${_hardwareId!.substring(0,6)}', systemInfo);
        
        setState(() {
          _isLoading = false;
          _device = null;
        });
        
        _startAuthCheck();
      }
    } catch (e) {
      setState(() {
        _error = '초기화 실패: $e';
        _isLoading = false;
      });
    }
  }

  void _startAuthCheck() {
    _authCheckTimer?.cancel();
    _authCheckTimer = Timer.periodic(const Duration(seconds: 10), (timer) async {
      final approvedDevice = await _supabase.getDeviceByHardwareId(_hardwareId!);
      if (approvedDevice != null && approvedDevice.categoryId != null) {
        timer.cancel();
        final prefs = await SharedPreferences.getInstance();
        await prefs.setString('mapped_device_id', approvedDevice.id);
        _loadDeviceData(approvedDevice.id);
      }
    });
  }

  Future<bool> _loadDeviceData(String deviceId) async {
    try {
      final device = await _supabase.getDevice(deviceId);
      // 기기가 없거나 카테고리가 할당되지 않았거나, 하드웨어 ID가 일치하지 않으면 연동 해제로 간주
      if (device == null || device.categoryId == null || device.hardwareId != _hardwareId) {
        final prefs = await SharedPreferences.getInstance();
        await prefs.remove('mapped_device_id');
        return false;
      }

      final schedules = await _supabase.getSchedules(deviceId);
      final systemInfo = await SystemMonitorService.getSystemInfo();
      await _supabase.updateStatus(deviceId, 'online', metadata: systemInfo);

      if (mounted) {
        setState(() {
          _device = device;
          _schedules = schedules;
          _isLoading = false;
        });
      }

      // Realtime 구독: 스케줄 변경 실시간 감시
      _schedulesSubscription?.cancel();
      _schedulesSubscription = _supabase.subscribeToSchedules(deviceId).listen((newSchedules) {
        debugPrint('Schedules updated via Realtime for device $deviceId');
        if (mounted) {
          setState(() {
            _schedules = newSchedules;
          });
        }
      });

      // Realtime 구독: 기기 정보(연동 상태 포함) 실시간 감시
      _deviceSubscription?.cancel();
      _deviceSubscription = _supabase.subscribeToDevice(deviceId).listen((data) async {
        final serverHwId = data['hardware_id'];
        if (serverHwId != _hardwareId) {
          debugPrint('Link removed or changed for device $deviceId: local=$_hardwareId, server=$serverHwId');
          _deviceSubscription?.cancel();
          _heartbeatTimer?.cancel();
          
          final prefs = await SharedPreferences.getInstance();
          await prefs.remove('mapped_device_id');
          
          if (mounted) {
            setState(() {
              _device = null;
              _error = '기기 연동이 해제되었습니다.';
            });
            _startAuthCheck();
          }
        }
      });

      _heartbeatTimer?.cancel();
      _heartbeatTimer = Timer.periodic(const Duration(minutes: 5), (timer) async {
        final info = await SystemMonitorService.getSystemInfo();
        _supabase.updateStatus(deviceId, 'online', metadata: info);
      });
      return true;
    } catch (e) {
      debugPrint('Load device data error: $e');
      return false;
    }
  }

  void _toggleInfoOverlay() {
    if (!mounted) return;
    setState(() {
      _showInfoOverlay = !_showInfoOverlay;
    });

    _overlayTimer?.cancel();
    if (_showInfoOverlay) {
      _overlayTimer = Timer(const Duration(seconds: 10), () {
        if (mounted) {
          setState(() => _showInfoOverlay = false);
        }
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_isLoading) {
      return const Scaffold(
        body: Center(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              CircularProgressIndicator(color: Colors.blue),
              SizedBox(height: 20),
              Text('시스템 준비 중...', style: TextStyle(color: Colors.white70)),
            ],
          ),
        ),
      );
    }

    Widget mainContent;
    if (_device == null) {
      mainContent = Scaffold(
        backgroundColor: const Color(0xFF121212),
        body: Center(
          child: Container(
            padding: const EdgeInsets.all(40),
            constraints: const BoxConstraints(maxWidth: 500),
            decoration: BoxDecoration(
              color: const Color(0xFF1E1E1E),
              borderRadius: BorderRadius.circular(20),
              boxShadow: const [BoxShadow(color: Colors.black54, blurRadius: 20)],
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.phonelink_setup, color: Colors.blue, size: 80),
                const SizedBox(height: 24),
                const Text('기기 등록 승인 대기 중', 
                  style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold, color: Colors.white)),
                const SizedBox(height: 16),
                const Text('이 기기가 CMS 관리자로부터 승인될 때까지 기다려 주세요. 승인이 완료되면 자동으로 재생이 시작됩니다.',
                  textAlign: TextAlign.center, style: TextStyle(color: Colors.white60, height: 1.5)),
                const SizedBox(height: 32),
                Container(
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(color: Colors.black26, borderRadius: BorderRadius.circular(10)),
                  child: Column(
                    children: [
                      const Text('고유 식별 코드 (Hardware ID)', style: TextStyle(color: Colors.white38, fontSize: 12)),
                      const SizedBox(height: 8),
                      SelectableText(_hardwareId ?? '로딩 중...', 
                        style: const TextStyle(color: Colors.blue, fontWeight: FontWeight.bold, fontSize: 16, fontFamily: 'monospace')),
                    ],
                  ),
                ),
                const SizedBox(height: 32),
                const CircularProgressIndicator(strokeWidth: 2),
                const SizedBox(height: 12),
                const Text('서버 연결 확인 중...', style: TextStyle(color: Colors.white24, fontSize: 12)),
              ],
            ),
          ),
        ),
      );
    } else {
      mainContent = PlayerScreen(device: _device!, schedules: _schedules);
    }

    return RawKeyboardListener(
      focusNode: FocusNode()..requestFocus(),
      onKey: (event) {
        if (event is RawKeyDownEvent && event.logicalKey.keyLabel == 'i') { // lowercase 'i' or 'I' check
          _toggleInfoOverlay();
        }
      },
      child: GestureDetector(
        onLongPress: _toggleInfoOverlay,
        child: Stack(
          children: [
            mainContent,
            if (_showInfoOverlay)
              Positioned(
                top: 20,
                right: 20,
                child: TweenAnimationBuilder<double>(
                  tween: Tween(begin: 0.0, end: 1.0),
                  duration: const Duration(milliseconds: 300),
                  builder: (context, value, child) {
                    return Opacity(
                      opacity: value,
                      child: Transform.translate(
                        offset: Offset(0, (1 - value) * -10),
                        child: child,
                      ),
                    );
                  },
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 16),
                    decoration: BoxDecoration(
                      color: Colors.black.withOpacity(0.85),
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(color: Colors.blue.withOpacity(0.5), width: 1),
                      boxShadow: [BoxShadow(color: Colors.black.withOpacity(0.5), blurRadius: 10)],
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.end,
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Text('DEVICE INFO', style: TextStyle(color: Colors.blue, fontWeight: FontWeight.bold, fontSize: 10, letterSpacing: 1.2)),
                        const SizedBox(height: 8),
                        Text('Name: ${_device?.name ?? "Unassigned"}', style: const TextStyle(color: Colors.white, fontSize: 14, fontWeight: FontWeight.bold)),
                        const SizedBox(height: 4),
                        Text('ID: ${_device?.id ?? "N/A"}', style: const TextStyle(color: Colors.white70, fontSize: 12)),
                        const SizedBox(height: 4),
                        Text('Hardware ID: $_hardwareId', style: const TextStyle(color: Colors.blue, fontSize: 12, fontWeight: FontWeight.w600, fontFamily: 'monospace')),
                        const SizedBox(height: 8),
                        const Divider(color: Colors.white10),
                        const SizedBox(height: 4),
                        Text('Status: ${_device?.status ?? "Unknown"}', style: TextStyle(color: _device?.status == 'online' ? Colors.green : Colors.red, fontSize: 11, fontWeight: FontWeight.bold)),
                      ],
                    ),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}
