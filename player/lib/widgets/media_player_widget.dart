import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter/foundation.dart'; // kIsWeb을 사용하기 위해 필요
import 'package:video_player/video_player.dart';
import '../models/models.dart';

class MediaPlayerWidget extends StatefulWidget {
  final String filePath;
  final MediaModel media;
  final VoidCallback onComplete;

  const MediaPlayerWidget({
    super.key,
    required this.filePath,
    required this.media,
    required this.onComplete,
  });

  @override
  State<MediaPlayerWidget> createState() => _MediaPlayerWidgetState();
}

class _MediaPlayerWidgetState extends State<MediaPlayerWidget> {
  VideoPlayerController? _controller;
  bool _isVideo = false;
  String _finalPath = '';

  // 초당 13ms 단축을 위한 배속 설정 (1000ms -> 987ms)
  // 1000 / (1000 - 13) = 1.013171225937183
  static const double _speedFactor = 1.013171225937183;

  @override
  void initState() {
    super.initState();
    _initPlayer();
  }

  void _initPlayer() {
    final format = widget.media.format.toLowerCase();
    _isVideo = format == 'mp4' || format == 'mov' || format == 'avi';
    print('Media Init: ${widget.media.title} ($format)');
    print('Media Path: ${widget.filePath}');

    final isRemote = widget.filePath.startsWith('http');
    _finalPath = widget.filePath;

    // Windows 로컬 경로 처리 최적화
    if (!kIsWeb && Platform.isWindows && !isRemote) {
      // 1. 슬래시 방향 통일 (Windows 표준 백슬래시)
      _finalPath = widget.filePath.replaceAll('/', '\\');
      // 2. 혹시 모를 URI 인코딩 제거 (이미 로컬 경로라면)
      if (_finalPath.startsWith('file:\\\\')) {
         _finalPath = Uri.parse(_finalPath).toFilePath();
      }
    }

    if (_isVideo) {
      if (kIsWeb || isRemote) {
        _controller = VideoPlayerController.networkUrl(Uri.parse(_finalPath));
      } else {
        _controller = VideoPlayerController.file(File(_finalPath));
      }

      _controller?.initialize().then((_) {
        if (!mounted) return;
        setState(() {});
        _controller?.setPlaybackSpeed(_speedFactor); // 배속 적용
        _controller?.play();
        print('Video started playing: ${widget.media.title}');
      }).catchError((error) {
        print('Video init error for ${widget.media.title}: $error');
        widget.onComplete(); // 에러 시 바로 다음 소재로 스킵
      });
      
      _controller?.addListener(() {
        if (_controller != null && _controller!.value.hasError) {
          widget.onComplete();
        }
        if (_controller?.value.position == _controller?.value.duration) {
          widget.onComplete();
        }
      });
    } else {
      // 이미지의 경우 보정된 시간만큼 대기
      final isRemote = widget.filePath.startsWith('http');
      if (!kIsWeb && !isRemote) {
        final file = File(widget.filePath);
        if (!file.existsSync()) {
          widget.onComplete();
          return;
        }
      }

      final adjustedDurationMs = (widget.media.duration * 1000 / _speedFactor).round();
      
      Future.delayed(Duration(milliseconds: adjustedDurationMs), () {
        if (mounted) widget.onComplete();
      });
    }
  }

  @override
  void dispose() {
    _controller?.removeListener(() {});
    _controller?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (_isVideo) {
      if (_controller != null && _controller!.value.hasError) {
        return const Center(child: Icon(Icons.broken_image, color: Colors.red));
      }
      return _controller != null && _controller!.value.isInitialized
          ? Center(
              child: AspectRatio(
                aspectRatio: _controller!.value.aspectRatio,
                child: VideoPlayer(_controller!),
              ),
            )
          : const Center(child: CircularProgressIndicator());
    } else {
      final isRemote = _finalPath.startsWith('http');
      return SizedBox.expand(
        child: (kIsWeb || isRemote)
          ? Image.network(
              _finalPath,
              fit: BoxFit.contain,
              errorBuilder: (context, error, stackTrace) {
                Future.microtask(() => widget.onComplete());
                return const Center(child: Icon(Icons.broken_image, color: Colors.red));
              },
            )
          : Image.file(
              File(_finalPath),
              fit: BoxFit.contain,
              errorBuilder: (context, error, stackTrace) {
                Future.microtask(() => widget.onComplete());
                return const Center(child: Icon(Icons.broken_image, color: Colors.red));
              },
            ),
      );
    }
  }
}
