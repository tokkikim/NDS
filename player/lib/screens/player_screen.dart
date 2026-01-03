import 'dart:async';
import 'package:flutter/material.dart';
import '../models/models.dart';
import '../services/media_cache_service.dart';
import '../services/supabase_service.dart';
import '../services/playback_sequence_service.dart';
import '../widgets/media_player_widget.dart';
import '../utils/time_utils.dart';

import '../services/sync_service.dart';
import 'package:intl/intl.dart' as intl;

class PlayerScreen extends StatefulWidget {
  final DeviceModel device;
  final List<ScheduleModel> schedules;
  
  const PlayerScreen({
    super.key, 
    required this.device, 
    required this.schedules
  });

  @override
  State<PlayerScreen> createState() => _PlayerScreenState();
}

class _PlayerScreenState extends State<PlayerScreen> {
  final MediaCacheService _cacheService = MediaCacheService();
  final SupabaseService _supabase = SupabaseService();
  
  List<ScheduleModel> _playSequence = [];
  int _currentIndex = 0;
  String? _currentFilePath;
  bool _isDownloading = true;
  bool _isOperating = true;
  Timer? _operatingTimer;

  List<int> _plannedStartTimesMs = [];
  DateTime? _baseStartTime;

  // 초당 13ms 단축 계수
  static const double _speedFactor = 1.01317;

  @override
  void initState() {
    super.initState();
    _initSequence();
    _startOperatingCheck();
  }

  @override
  void didUpdateWidget(PlayerScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    // 스케줄 데이터가 변경된 경우 시퀀스 재구성
    if (oldWidget.schedules != widget.schedules) {
      debugPrint('[PlayerScreen] Schedules changed, refreshing sequence...');
      _initSequence();
    }
  }

  void _initSequence() {
    // 1. 편성 정책 기반 시뮬레이션 수행 (전체 운영 시간 대상)
    final opSeconds = TimeUtils.parseTimeToSeconds(widget.device.opEndTime) - 
                      TimeUtils.parseTimeToSeconds(widget.device.opStartTime);
    final finalOpSeconds = opSeconds <= 0 ? 86400 : opSeconds;

    final service = PlaybackSequenceService(
      schedules: widget.schedules, // 필터링 없이 전체 전달
      totalSlots: widget.device.totalSlots,
      policyPlays: widget.device.policyPlays,
      defaultSlotDuration: widget.device.slotDuration,
    );
    
    _playSequence = service.generateSequence(finalOpSeconds, widget.device.opStartTime);
    
    _calculateStartTimes();
    _syncToSequence();
  }

  List<String> _startTimes = [];

  void _calculateStartTimes() {
    final startParts = widget.device.opStartTime.split(':');
    final startH = int.parse(startParts[0]);
    final startM = int.parse(startParts[1]);
    final startS = startParts.length > 2 ? int.parse(startParts[2]) : 0;
    
    final now = SyncService.now;
    _baseStartTime = DateTime(now.year, now.month, now.day, startH, startM, startS);
    if (now.isBefore(_baseStartTime!)) {
      _baseStartTime = _baseStartTime!.subtract(const Duration(days: 1));
    }

    DateTime startRef = DateTime(2000, 1, 1, startH, startM, startS);
    List<String> times = [];
    List<int> msList = [];
    
    int accumMs = 0;
    for (var item in _playSequence) {
      times.add(intl.DateFormat('HH:mm:ss').format(startRef.add(Duration(milliseconds: accumMs))));
      msList.add(accumMs);
      accumMs += (item.media?.duration ?? 15) * 1000;
    }
    
    setState(() {
      _startTimes = times;
      _plannedStartTimesMs = msList;
    });
  }

  void _syncToSequence() {
    // [절대 동기화] 현재 시각에 정확히 일치하는 인덱스 찾기
    final now = SyncService.now;
    
    final startParts = widget.device.opStartTime.split(':');
    final startH = int.parse(startParts[0]);
    final startM = int.parse(startParts[1]);
    final startS = startParts.length > 2 ? int.parse(startParts[2]) : 0;
    
    var baseStartTime = DateTime(now.year, now.month, now.day, startH, startM, startS);
    if (now.isBefore(baseStartTime)) {
      baseStartTime = baseStartTime.subtract(const Duration(days: 1));
    }

    final elapsedMs = now.difference(_baseStartTime!).inMilliseconds;
    
    // 누적 시간을 바탕으로 현재 시점이 속한 인덱스 결정
    int targetIdx = -1;
    for (int i = 0; i < _playSequence.length; i++) {
       final startMs = _plannedStartTimesMs[i];
       final durMs = (_playSequence[i].media?.duration ?? 15) * 1000;
       
       if (elapsedMs >= startMs && elapsedMs < startMs + durMs) {
         targetIdx = i;
         break;
       }
    }

    if (targetIdx == -1) {
       // 운영 시간을 벗어났거나 리스트 끝에 도달 (루프하지 않음)
       _currentIndex = 0;
       setState(() {
         _currentFilePath = null;
       });
       return;
    }

    print('[SyncDebug] Absolute Sync: Now ${intl.DateFormat('HH:mm:ss').format(now)} -> Target Index $targetIdx');
    
    _currentIndex = targetIdx;
    _playNext();
  }

  void _startOperatingCheck() {
    _operatingTimer = Timer.periodic(const Duration(seconds: 10), (timer) {
      final nowOperating = TimeUtils.isOperating(widget.device.opStartTime, widget.device.opEndTime);
      
      if (nowOperating != _isOperating) {
        setState(() {
          _isOperating = nowOperating;
        });
        if (_isOperating) {
          _initSequence(); // 운영 재개 시 큐 다시 생성 및 동기화
        }
      } else if (_isOperating) {
        // 매 분 정각(00초) 근처에서 한 번씩 리프레시해주는 것이 안전
        final nowSeconds = DateTime.now().second;
        if (nowSeconds < 10) { // 매 분 초반 10초 동안 1회 체크
           _initSequence();
        }
      }
    });
    
    _isOperating = TimeUtils.isOperating(widget.device.opStartTime, widget.device.opEndTime);
  }

  Future<void> _playNext() async {
    if (_playSequence.isEmpty || !_isOperating) return;

    if (_currentIndex >= _playSequence.length) {
      _currentIndex = 0; // 루프
    }

    // [중요] 정밀 동기화: 계획된 시각까지 대기
    if (_baseStartTime != null && _currentIndex < _plannedStartTimesMs.length) {
      final plannedStart = _baseStartTime!.add(Duration(milliseconds: _plannedStartTimesMs[_currentIndex]));
      final now = SyncService.now;
      final waitMs = plannedStart.difference(now).inMilliseconds;
      if (waitMs > 10) { // 10ms 이상 차이날 때만 대기
        await Future.delayed(Duration(milliseconds: waitMs));
      }
    }

    setState(() {
      _isDownloading = true;
    });

    final currentSchedule = _playSequence[_currentIndex];
    final media = currentSchedule.media;

    if (media != null && media.id != 'black') {
      final filePath = await _cacheService.getCachedFile(media.fileUrl, mediaId: media.id);
      if (mounted) {
        setState(() {
          _currentFilePath = filePath;
          _isDownloading = false;
        });
        _preCacheNext();
      }
    } else {
      // 블랙 스크린(공백) 처리: 기간만큼 대기 후 다음으로 이동
      setState(() {
        _currentFilePath = null;
        _isDownloading = false;
      });
      Future.delayed(Duration(seconds: media?.duration ?? 15), () {
        if (mounted) _onMediaComplete();
      });
    }
  }

  void _preCacheNext() {
    final nextIndex = (_currentIndex + 1) % _playSequence.length;
    final nextMedia = _playSequence[nextIndex].media;
    if (nextMedia != null && nextMedia.id != 'black') {
      _cacheService.getCachedFile(nextMedia.fileUrl, mediaId: nextMedia.id);
    }
  }

  void _onMediaComplete() {
    if (!mounted) return;

    // 송출 로그 기록 (PoP)
    final media = _playSequence[_currentIndex].media;
    if (media != null && media.id != 'black') {
      // 배속이 적용된 실제 밀리초 계산
      final actualDurationMs = (media.duration * 1000 / _speedFactor).round();
      _supabase.logPlayback(widget.device.id, media.id, actualDurationMs);
    }

    setState(() {
      _currentIndex = (_currentIndex + 1) % _playSequence.length;
    });
    
    if (_isOperating) {
      _playNext();
    }
  }

  @override
  void dispose() {
    _operatingTimer?.cancel();
    super.dispose();
  }

  bool _showSchedule = false;

  @override
  Widget build(BuildContext context) {
    if (!_isOperating) {
      return const Scaffold(
        backgroundColor: Colors.black,
        body: Center(
          child: Text('운영 시간 종료 (Black Screen)', 
            style: TextStyle(color: Colors.white24, fontSize: 12)),
        ),
      );
    }

    if (_playSequence.isEmpty) {
      return const Scaffold(
        body: Center(child: Text('편성 정보 없음')),
      );
    }

    if (_isDownloading && _currentFilePath == null) {
      final currentMedia = _playSequence[_currentIndex].media;
      if (currentMedia != null && currentMedia.id == 'black') {
         // 블랙 스크린 섹션인 경우 다운로드 중 표시 안 함
      } else {
        return const Scaffold(
          body: Center(child: CircularProgressIndicator()),
        );
      }
    }

    final currentMedia = _playSequence[_currentIndex].media;

    return Scaffold(
      body: Stack(
        children: [
          // 1. 미디어 플레이어 영역
          if (_currentFilePath != null && currentMedia != null)
            MediaPlayerWidget(
              key: ValueKey('$_currentIndex-${currentMedia.id}'),
              filePath: _currentFilePath!,
              media: currentMedia,
              onComplete: _onMediaComplete,
            )
          else
            Container(color: Colors.black), // 공백(Black) 구간
          
          // 2. 우측 상단 유틸리티 버튼
          Positioned(
            top: 20,
            right: 20,
            child: Row(
              children: [
                if (_isDownloading && currentMedia?.id != 'black')
                  const Padding(
                    padding: EdgeInsets.only(right: 12),
                    child: SizedBox(
                      width: 20, height: 20,
                      child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                    ),
                  ),
                IconButton(
                  icon: Icon(_showSchedule ? Icons.close : Icons.list_alt, color: Colors.white70),
                  onPressed: () => setState(() => _showSchedule = !_showSchedule),
                  style: IconButton.styleFrom(backgroundColor: Colors.black45),
                ),
              ],
            ),
          ),

          // 3. 편성표 오버레이 (Drawer 스타일)
          if (_showSchedule)
            Positioned(
              top: 0, right: 0, bottom: 0,
              width: 350,
              child: Container(
                decoration: const BoxDecoration(
                  color: Color(0xEE1A1A1A),
                  boxShadow: [BoxShadow(blurRadius: 10, color: Colors.black54)],
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Padding(
                      padding: EdgeInsets.fromLTRB(20, 50, 20, 10),
                      child: Text('현재 편성 큐 (Today)', 
                        style: TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
                    ),
                    Expanded(
                      child: ListView.builder(
                        padding: const EdgeInsets.symmetric(vertical: 10),
                        itemCount: _playSequence.length,
                        itemBuilder: (context, index) {
                          final item = _playSequence[index];
                          final isCurrent = index == _currentIndex;
                          return Container(
                            color: isCurrent ? Colors.blue.withOpacity(0.3) : null,
                            padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 8),
                            child: Row(
                              children: [
                                SizedBox(
                                  width: 60,
                                  child: Text(
                                    _startTimes.length > index ? _startTimes[index] : '--:--:--',
                                    style: TextStyle(color: isCurrent ? Colors.blue : Colors.white24, fontSize: 11, fontFamily: 'monospace'),
                                  ),
                                ),
                                const SizedBox(width: 10),
                                Expanded(
                                  child: Column(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      Row(
                                        children: [
                                          if (isCurrent)
                                            Container(
                                              padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 2),
                                              margin: const EdgeInsets.only(right: 6),
                                              decoration: BoxDecoration(color: Colors.blue, borderRadius: BorderRadius.circular(2)),
                                              child: const Text('NOW', style: TextStyle(color: Colors.white, fontSize: 9, fontWeight: FontWeight.bold)),
                                            ),
                                          Expanded(
                                            child: Text(item.media?.title ?? 'Untitled', 
                                              style: TextStyle(color: isCurrent ? Colors.white : Colors.white70, fontSize: 14, fontWeight: isCurrent ? FontWeight.bold : FontWeight.normal),
                                              maxLines: 1, overflow: TextOverflow.ellipsis),
                                          ),
                                        ],
                                      ),
                                      Text('Slot ${item.slotNo} - ${item.media?.duration}s', 
                                        style: const TextStyle(color: Colors.white38, fontSize: 11)),
                                    ],
                                  ),
                                ),
                              ],
                            ),
                          );
                        },
                      ),
                    ),
                  ],
                ),
              ),
            ),
        ],
      ),
    );
  }
}
