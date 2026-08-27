import sys
import gi
import os
gi.require_version('Gst', '1.0')
from gi.repository import Gst, GLib

Gst.init(None)

video_path = "/app/026c7465-309f6d33.mp4"
out_path = "/app/tracked_output.mp4"
config_path = "/app/models_config/config_infer_primary.txt"
tracker_config = "/app/models_config/tracker_config.yml"
tracker_lib = "/opt/nvidia/deepstream/deepstream/lib/libnvds_nvmultiobjecttracker.so"

print("Building pipeline for video export...")
pipeline = Gst.Pipeline()

source = Gst.ElementFactory.make("filesrc", "file-source")
source.set_property("location", video_path)

decodebin = Gst.ElementFactory.make("nvurisrcbin", "nvuri")
decodebin.set_property("uri", f"file://{video_path}")

muxer = Gst.ElementFactory.make("nvstreammux", "muxer")
muxer.set_property("batch-size", 1)
muxer.set_property("width", 1280)
muxer.set_property("height", 720)
muxer.set_property("batched-push-timeout", 40000)

pgie = Gst.ElementFactory.make("nvinfer", "primary-inference")
pgie.set_property("config-file-path", config_path)

tracker = Gst.ElementFactory.make("nvtracker", "tracker")
tracker.set_property("ll-lib-file", tracker_lib)
tracker.set_property("ll-config-file", tracker_config)

nvvidconv = Gst.ElementFactory.make("nvvideoconvert", "convertor")
nvosd = Gst.ElementFactory.make("nvdsosd", "onscreendisplay")

nvvidconv2 = Gst.ElementFactory.make("nvvideoconvert", "convertor2")
encoder = Gst.ElementFactory.make("nvv4l2h264enc", "h264encoder")
h264parse = Gst.ElementFactory.make("h264parse", "h264parse")
qtmux = Gst.ElementFactory.make("qtmux", "qtmux")
sink = Gst.ElementFactory.make("filesink", "filesink")
sink.set_property("location", out_path)
sink.set_property("sync", False)

elements = [decodebin, muxer, pgie, tracker, nvvidconv, nvosd, nvvidconv2, encoder, h264parse, qtmux, sink]
for i, el in enumerate(elements):
    if not el:
        print(f"Failed to create element index {i}")
        sys.exit(1)
    pipeline.add(el)

def cb_newpad(decodebin, pad, data):
    print("Pad added!")
    sinkpad = muxer.get_request_pad("sink_0")
    pad.link(sinkpad)

decodebin.connect("pad-added", cb_newpad, None)

muxer.link(pgie)
pgie.link(tracker)
tracker.link(nvvidconv)
nvvidconv.link(nvosd)
nvosd.link(nvvidconv2)
nvvidconv2.link(encoder)
encoder.link(h264parse)
h264parse.link(qtmux)
qtmux.link(sink)

loop = GLib.MainLoop()
bus = pipeline.get_bus()
bus.add_signal_watch()

def bus_call(bus, message, loop):
    t = message.type
    if t == Gst.MessageType.EOS:
        print("End of stream")
        loop.quit()
    elif t == Gst.MessageType.ERROR:
        err, debug = message.parse_error()
        print(f"Error: {err} : {debug}")
        loop.quit()
    return True

bus.connect("message", bus_call, loop)

print("Starting pipeline...")
pipeline.set_state(Gst.State.PLAYING)
try:
    loop.run()
except:
    pass

pipeline.set_state(Gst.State.NULL)
print(f"Export complete: {out_path}")
