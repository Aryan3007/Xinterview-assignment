"use client"

import type React from "react"

// Add type declarations for PDF.js and PDF-lib
interface PDFDocumentProxy {
  numPages: number;
  getPage: (pageNumber: number) => Promise<PDFPageProxy>;
}

interface PDFPageViewport {
  width: number;
  height: number;
}

interface PDFPageProxy {
  getViewport: (options: { scale: number }) => PDFPageViewport;
  render: (options: { canvasContext: CanvasRenderingContext2D; viewport: PDFPageViewport }) => { promise: Promise<void> };
}

interface PDFJSLib {
  getDocument: (data: ArrayBuffer) => { promise: Promise<PDFDocumentProxy> };
  GlobalWorkerOptions: { workerSrc: string };
}

interface PDFDocument {
  pages: PDFPage[];
  embedPng: (imageData: string) => Promise<PDFImage>;
  addPage: (dimensions: [number, number]) => PDFPage;
  save: () => Promise<Uint8Array>;
}

interface PDFPage {
  drawImage: (image: PDFImage, options: { x: number; y: number; width: number; height: number }) => void;
}

interface PDFImage {
  width: number;
  height: number;
}

interface PDFLib {
  PDFDocument: {
    create: () => Promise<PDFDocument>;
  };
}

declare global {
  interface Window {
    pdfjsLib: PDFJSLib;
    PDFLib: PDFLib;
  }
}

import { useState, useRef, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Slider } from "@/components/ui/slider"
import { Textarea } from "@/components/ui/textarea"
import {
  Upload,
  Edit3,
  Download,
  CloudyIcon as Blur,
  Eraser,
  Type,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  Move,
  Check,
  X,
} from "lucide-react"

interface BlurStroke {
  x: number
  y: number
  size: number
  intensity: number
}

interface EraseStroke {
  x: number
  y: number
  size: number
}

interface EditAction {
  type: "blur" | "erase"
  strokes: BlurStroke[] | EraseStroke[]
}

interface TextBox {
  id: string
  x: number
  y: number
  text: string
  fontSize: number
  color: string
  isEditing: boolean
}

export default function PDFEditor() {
  const [pdfFile, setPdfFile] = useState<File | null>(null)
  const [isEditing, setIsEditing] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [totalPages, setTotalPages] = useState(0)
  const [editMode, setEditMode] = useState<"blur" | "erase" | "text" | null>(null)
  const [editActions, setEditActions] = useState<{ [page: number]: EditAction[] }>({})
  const [textBoxes, setTextBoxes] = useState<{ [page: number]: TextBox[] }>({})
  const [isDrawing, setIsDrawing] = useState(false)
  const [currentStrokes, setCurrentStrokes] = useState<BlurStroke[] | EraseStroke[]>([])
  const [brushSize, setBrushSize] = useState(20)
  const [fontSize, setFontSize] = useState(16)
  const [textColor, setTextColor] = useState("#000000")
  const [blurIntensity, setBlurIntensity] = useState(5)
  const [draggedTextBox, setDraggedTextBox] = useState<string | null>(null)
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 })
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 })
  const [isLoading, setIsLoading] = useState(false)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const pdfDocRef = useRef<PDFDocumentProxy>(null)
  const originalCanvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    // Load PDF.js
    const script = document.createElement("script")
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"
    script.onload = () => {
      // @ts-ignore
      window.pdfjsLib.GlobalWorkerOptions.workerSrc =
        "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js"
    }
    document.head.appendChild(script)
  }, [])

  // Add new useEffect for rendering first page when entering edit mode
  useEffect(() => {
    if (isEditing && pdfDocRef.current) {
      setIsLoading(true)
      renderPage(currentPage).finally(() => {
        setIsLoading(false)
      })
    }
  }, [isEditing])

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file && file.type === "application/pdf") {
      setPdfFile(file)
      await loadPDF(file)
    }
  }

  const loadPDF = async (file: File) => {
    const arrayBuffer = await file.arrayBuffer()
    // @ts-ignore
    const pdf = await window.pdfjsLib.getDocument(arrayBuffer).promise
    pdfDocRef.current = pdf
    setTotalPages(pdf.numPages)
    setCurrentPage(1)

    // Ensure we wait for the page to render completely
    await renderPage(1, pdf)
  }

  const renderPage = async (pageNum: number, pdf?: PDFDocumentProxy) => {
    const pdfDoc = pdf || pdfDocRef.current
    if (!pdfDoc) return

    try {
      const page = await pdfDoc.getPage(pageNum)
      const canvas = canvasRef.current
      const originalCanvas = originalCanvasRef.current
      if (!canvas || !originalCanvas) return

      const context = canvas.getContext("2d")
      const originalContext = originalCanvas.getContext("2d")
      if (!context || !originalContext) return

      const viewport = page.getViewport({ scale: 1.5 })
      canvas.height = viewport.height
      canvas.width = viewport.width
      originalCanvas.height = viewport.height
      originalCanvas.width = viewport.width

      // Clear both canvases
      context.clearRect(0, 0, canvas.width, canvas.height)
      originalContext.clearRect(0, 0, originalCanvas.width, originalCanvas.height)

      // Render original to hidden canvas and wait for it to complete
      await page.render({
        canvasContext: originalContext,
        viewport: viewport,
      }).promise

      // Copy to main canvas
      context.drawImage(originalCanvas, 0, 0)

      // Apply existing edits for this page
      applyAllEdits(pageNum)
    } catch (error) {
      console.error("Error rendering page:", error)
    }
  }

  const applyAllEdits = (pageNum: number) => {
    const canvas = canvasRef.current
    const originalCanvas = originalCanvasRef.current
    if (!canvas || !originalCanvas) return

    const context = canvas.getContext("2d")
    const originalContext = originalCanvas.getContext("2d")
    if (!context || !originalContext) return

    // Start fresh from original
    context.clearRect(0, 0, canvas.width, canvas.height)
    context.drawImage(originalCanvas, 0, 0)

    const actions = editActions[pageNum] || []

    actions.forEach((action) => {
      if (action.type === "blur") {
        applyBlurStrokes(action.strokes as BlurStroke[], context, originalContext)
      } else if (action.type === "erase") {
        applyEraseStrokes(action.strokes as EraseStroke[], context)
      }
    })
  }

  const applyBlurStrokes = (
    strokes: BlurStroke[],
    context: CanvasRenderingContext2D,
    originalContext: CanvasRenderingContext2D,
  ) => {
    strokes.forEach((stroke) => {
      const radius = stroke.size / 2

      // Create a temporary canvas for the blur effect
      const tempCanvas = document.createElement("canvas")
      const tempContext = tempCanvas.getContext("2d")
      if (!tempContext) return

      tempCanvas.width = stroke.size
      tempCanvas.height = stroke.size

      // Get the original image data for this area
      const sourceX = Math.max(0, stroke.x - radius)
      const sourceY = Math.max(0, stroke.y - radius)
      const sourceWidth = Math.min(stroke.size, originalContext.canvas.width - sourceX)
      const sourceHeight = Math.min(stroke.size, originalContext.canvas.height - sourceY)

      if (sourceWidth > 0 && sourceHeight > 0) {
        // Draw the original area to temp canvas
        tempContext.drawImage(
          originalContext.canvas,
          sourceX,
          sourceY,
          sourceWidth,
          sourceHeight,
          0,
          0,
          sourceWidth,
          sourceHeight,
        )

        // Apply blur filter and draw back to main canvas
        context.save()
        context.filter = `blur(${stroke.intensity}px)`
        context.drawImage(tempCanvas, sourceX, sourceY)
        context.restore()
      }
    })
  }

  const applyEraseStrokes = (strokes: EraseStroke[], context: CanvasRenderingContext2D) => {
    strokes.forEach((stroke) => {
      context.save()
      context.fillStyle = "#ffffff"
      context.beginPath()
      context.arc(stroke.x, stroke.y, stroke.size / 2, 0, 2 * Math.PI)
      context.fill()
      context.restore()
    })
  }

  const getCanvasCoordinates = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }

    const rect = canvas.getBoundingClientRect()
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    }
  }

  const handleCanvasMouseDown = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const { x, y } = getCanvasCoordinates(event)

    if (editMode === "text") {
      createTextBox(x, y)
      return
    }

    if (editMode === "blur" || editMode === "erase") {
      setIsDrawing(true)
      setCurrentStrokes([])
      addStrokePoint(x, y)
    }
  }

  const handleCanvasMouseMove = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const { x, y } = getCanvasCoordinates(event)
    setMousePos({ x, y })

    if (!isDrawing || !editMode) return

    addStrokePoint(x, y)
  }

  const handleCanvasMouseUp = () => {
    if (isDrawing && currentStrokes.length > 0) {
      // Save the current strokes as an edit action
      const newAction: EditAction = {
        type: editMode as "blur" | "erase",
        strokes: currentStrokes,
      }

      setEditActions((prev) => ({
        ...prev,
        [currentPage]: [...(prev[currentPage] || []), newAction],
      }))
    }

    setIsDrawing(false)
    setCurrentStrokes([])
  }

  const addStrokePoint = (x: number, y: number) => {
    const canvas = canvasRef.current
    const originalCanvas = originalCanvasRef.current
    if (!canvas || !originalCanvas) return

    const context = canvas.getContext("2d")
    const originalContext = originalCanvas.getContext("2d")
    if (!context || !originalContext) return

    if (editMode === "blur") {
      const newStroke: BlurStroke = {
        x,
        y,
        size: brushSize,
        intensity: blurIntensity,
      }

      setCurrentStrokes((prev) => [...prev, newStroke])

      // Apply blur immediately for visual feedback
      const radius = brushSize / 2
      const tempCanvas = document.createElement("canvas")
      const tempContext = tempCanvas.getContext("2d")
      if (!tempContext) return

      tempCanvas.width = brushSize
      tempCanvas.height = brushSize

      const sourceX = Math.max(0, x - radius)
      const sourceY = Math.max(0, y - radius)
      const sourceWidth = Math.min(brushSize, originalCanvas.width - sourceX)
      const sourceHeight = Math.min(brushSize, originalCanvas.height - sourceY)

      if (sourceWidth > 0 && sourceHeight > 0) {
        tempContext.drawImage(
          originalCanvas,
          sourceX,
          sourceY,
          sourceWidth,
          sourceHeight,
          0,
          0,
          sourceWidth,
          sourceHeight,
        )

        context.save()
        context.filter = `blur(${blurIntensity}px)`
        context.drawImage(tempCanvas, sourceX, sourceY)
        context.restore()
      }
    } else if (editMode === "erase") {
      const newStroke: EraseStroke = {
        x,
        y,
        size: brushSize,
      }

      setCurrentStrokes((prev) => [...prev, newStroke])

      // Apply erase immediately
      context.save()
      context.fillStyle = "#ffffff"
      context.beginPath()
      context.arc(x, y, brushSize / 2, 0, 2 * Math.PI)
      context.fill()
      context.restore()
    }
  }

  const createTextBox = (x: number, y: number) => {
    const newTextBox: TextBox = {
      id: Date.now().toString(),
      x,
      y,
      text: "",
      fontSize,
      color: textColor,
      isEditing: true,
    }

    setTextBoxes((prev) => ({
      ...prev,
      [currentPage]: [...(prev[currentPage] || []), newTextBox],
    }))
  }

  const updateTextBox = (id: string, updates: Partial<TextBox>) => {
    setTextBoxes((prev) => ({
      ...prev,
      [currentPage]: (prev[currentPage] || []).map((box) => (box.id === id ? { ...box, ...updates } : box)),
    }))
  }

  const deleteTextBox = (id: string) => {
    setTextBoxes((prev) => ({
      ...prev,
      [currentPage]: (prev[currentPage] || []).filter((box) => box.id !== id),
    }))
  }

  const handleTextBoxMouseDown = (event: React.MouseEvent, textBox: TextBox) => {
    event.stopPropagation()
    if (textBox.isEditing) return

    setDraggedTextBox(textBox.id)
    const rect = canvasRef.current?.getBoundingClientRect()
    if (rect) {
      setDragOffset({
        x: event.clientX - rect.left - textBox.x,
        y: event.clientY - rect.top - textBox.y,
      })
    }
  }

  const handleMouseMove = useCallback(
    (event: MouseEvent) => {
      if (!draggedTextBox) return

      const rect = canvasRef.current?.getBoundingClientRect()
      if (rect) {
        const newX = event.clientX - rect.left - dragOffset.x
        const newY = event.clientY - rect.top - dragOffset.y

        updateTextBox(draggedTextBox, { x: newX, y: newY })
      }
    },
    [draggedTextBox, dragOffset],
  )

  const handleMouseUp = useCallback(() => {
    setDraggedTextBox(null)
  }, [])

  useEffect(() => {
    if (draggedTextBox) {
      document.addEventListener("mousemove", handleMouseMove)
      document.addEventListener("mouseup", handleMouseUp)
      return () => {
        document.removeEventListener("mousemove", handleMouseMove)
        document.removeEventListener("mouseup", handleMouseUp)
      }
    }
  }, [draggedTextBox, handleMouseMove, handleMouseUp])

  const changePage = async (direction: "prev" | "next") => {
    const newPage = direction === "prev" ? currentPage - 1 : currentPage + 1
    if (newPage >= 1 && newPage <= totalPages) {
      setIsLoading(true)
      setCurrentPage(newPage)
      await renderPage(newPage)
      setIsLoading(false)
    }
  }

  const clearPageEdits = () => {
    setEditActions((prev) => ({
      ...prev,
      [currentPage]: [],
    }))
    setTextBoxes((prev) => ({
      ...prev,
      [currentPage]: [],
    }))
    renderPage(currentPage)
  }

  const downloadPDF = async () => {
    if (!pdfDocRef.current || !pdfFile) return

    try {
      // Load PDF.js script for PDF generation if not already loaded
      if (!window.pdfjsLib) {
        await new Promise((resolve) => {
          const script = document.createElement("script")
          script.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"
          script.onload = resolve
          document.head.appendChild(script)
        })
        // @ts-ignore
        window.pdfjsLib.GlobalWorkerOptions.workerSrc =
          "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js"
      }

      // Load pdf-lib for PDF manipulation
      const pdfLibScript = document.createElement("script")
      pdfLibScript.src = "https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.min.js"
      document.head.appendChild(pdfLibScript)

      await new Promise((resolve) => {
        pdfLibScript.onload = resolve
      })

      // @ts-ignore
      const { PDFDocument } = window.PDFLib

      // Create a new PDF document
      const pdfDoc = await PDFDocument.create()

      // Process each page
      for (let i = 1; i <= totalPages; i++) {
        // Switch to the page and render it with edits
        await renderPage(i)

        // Render text boxes to canvas
        const canvas = canvasRef.current
        if (!canvas) continue

        const context = canvas.getContext("2d")
        if (!context) continue

        const currentTextBoxes = textBoxes[i] || []
        currentTextBoxes.forEach((textBox) => {
          if (textBox.text.trim()) {
            context.fillStyle = textBox.color
            context.font = `${textBox.fontSize}px Arial`
            context.fillText(textBox.text, textBox.x, textBox.y)
          }
        })

        // Convert canvas to image
        const imageData = canvas.toDataURL("image/png")
        const pngImage = await pdfDoc.embedPng(imageData)

        // Add a new page to the PDF
        const page = pdfDoc.addPage([canvas.width, canvas.height])

        // Draw the image on the page
        page.drawImage(pngImage, {
          x: 0,
          y: 0,
          width: canvas.width,
          height: canvas.height,
        })
      }

      // Save the PDF
      const pdfBytes = await pdfDoc.save()

      // Create a blob and download
      const blob = new Blob([pdfBytes], { type: "application/pdf" })
      const link = document.createElement("a")
      link.href = URL.createObjectURL(blob)
      link.download = "edited-pdf.pdf"
      link.click()

      // Return to the current page
      renderPage(currentPage)
    } catch (error) {
      console.error("Error generating PDF:", error)
      alert("There was an error generating the PDF. Downloading current page as image instead.")

      // Fallback to image download
      const canvas = canvasRef.current
      if (!canvas) return

      const link = document.createElement("a")
      link.download = "edited-pdf-page.png"
      link.href = canvas.toDataURL()
      link.click()
    }
  }

  if (!pdfFile) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="p-8 text-center">
            <div className="mb-6">
              <Upload className="w-16 h-16 mx-auto text-blue-500 mb-4" />
              <h1 className="text-2xl font-bold text-gray-900 mb-2">PDF Editor</h1>
              <p className="text-gray-600">Upload a PDF file to start editing</p>
            </div>

            <div className="space-y-4">
              <Button onClick={() => fileInputRef.current?.click()} className="w-full" size="lg">
                <Upload className="w-4 h-4 mr-2" />
                Choose PDF File
              </Button>

              <input ref={fileInputRef} type="file" accept=".pdf" onChange={handleFileUpload} className="hidden" />

              <p className="text-sm text-gray-500">Supported format: PDF files only</p>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!isEditing) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="p-8 text-center">
            <div className="mb-6">
              <Edit3 className="w-16 h-16 mx-auto text-green-500 mb-4" />
              <h1 className="text-2xl font-bold text-gray-900 mb-2">PDF Uploaded Successfully</h1>
              <p className="text-gray-600 mb-4">File: {pdfFile.name}</p>
              <p className="text-sm text-gray-500">Pages: {totalPages}</p>
            </div>

            <div className="space-y-4">
              <Button onClick={() => setIsEditing(true)} className="w-full" size="lg">
                <Edit3 className="w-4 h-4 mr-2" />
                Start Editing
              </Button>

              <Button
                variant="outline"
                onClick={() => {
                  setPdfFile(null)
                  setIsEditing(false)
                  setEditActions({})
                  setTextBoxes({})
                }}
                className="w-full"
              >
                Upload Different File
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 p-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <h1 className="text-xl font-semibold text-gray-900">PDF Editor</h1>
            <span className="text-sm text-gray-500">{pdfFile.name}</span>
          </div>

          <div className="flex items-center space-x-2">
            <Button variant="outline" size="sm" onClick={() => setIsEditing(false)}>
              Back to Upload
            </Button>
            <Button
              onClick={async () => {
                setIsLoading(true)
                await downloadPDF()
                setIsLoading(false)
              }}
              size="sm"
              disabled={isLoading}
            >
              {isLoading ? (
                <>
                  <span className="animate-spin mr-2">⏳</span>
                  Processing...
                </>
              ) : (
                <>
                  <Download className="w-4 h-4 mr-2" />
                  Download PDF
                </>
              )}
            </Button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto p-4 grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Tools Panel */}
        <div className="lg:col-span-1">
          <Card>
            <CardContent className="p-4">
              <h3 className="font-semibold mb-4">Editing Tools</h3>

              <div className="space-y-3">
                <Button
                  variant={editMode === "blur" ? "default" : "outline"}
                  onClick={() => setEditMode(editMode === "blur" ? null : "blur")}
                  className="w-full justify-start"
                >
                  <Blur className="w-4 h-4 mr-2" />
                  Blur Brush
                </Button>

                <Button
                  variant={editMode === "erase" ? "default" : "outline"}
                  onClick={() => setEditMode(editMode === "erase" ? null : "erase")}
                  className="w-full justify-start"
                >
                  <Eraser className="w-4 h-4 mr-2" />
                  Eraser Brush
                </Button>

                <Button
                  variant={editMode === "text" ? "default" : "outline"}
                  onClick={() => setEditMode(editMode === "text" ? null : "text")}
                  className="w-full justify-start"
                >
                  <Type className="w-4 h-4 mr-2" />
                  Add Text
                </Button>
              </div>

              <Separator className="my-4" />

              {/* Brush Options */}
              {(editMode === "blur" || editMode === "erase") && (
                <div className="space-y-3">
                  <div>
                    <Label className="text-sm">Brush Size</Label>
                    <Slider
                      value={[brushSize]}
                      onValueChange={(value) => setBrushSize(value[0])}
                      max={50}
                      min={5}
                      step={5}
                      className="mt-2"
                    />
                    <span className="text-xs text-gray-500">{brushSize}px</span>
                  </div>

                  {editMode === "blur" && (
                    <div>
                      <Label className="text-sm">Blur Intensity</Label>
                      <Slider
                        value={[blurIntensity]}
                        onValueChange={(value) => setBlurIntensity(value[0])}
                        max={20}
                        min={1}
                        step={1}
                        className="mt-2"
                      />
                      <span className="text-xs text-gray-500">{blurIntensity}px</span>
                    </div>
                  )}
                </div>
              )}

              {/* Text Options */}
              {editMode === "text" && (
                <div className="space-y-3">
                  <div>
                    <Label className="text-sm">Font Size</Label>
                    <Slider
                      value={[fontSize]}
                      onValueChange={(value) => setFontSize(value[0])}
                      max={48}
                      min={8}
                      step={2}
                      className="mt-2"
                    />
                    <span className="text-xs text-gray-500">{fontSize}px</span>
                  </div>

                  <div>
                    <Label className="text-sm">Text Color</Label>
                    <Input
                      type="color"
                      value={textColor}
                      onChange={(e) => setTextColor(e.target.value)}
                      className="mt-1 h-8"
                    />
                  </div>
                </div>
              )}

              <Separator className="my-4" />

              <Button variant="outline" onClick={clearPageEdits} className="w-full">
                <RotateCcw className="w-4 h-4 mr-2" />
                Clear Page Edits
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* PDF Viewer */}
        <div className="lg:col-span-3">
          <Card>
            <CardContent className="p-4">
              {/* Page Navigation */}
              <div className="flex items-center justify-between mb-4">
                <Button variant="outline" size="sm" onClick={() => changePage("prev")} disabled={currentPage <= 1}>
                  <ChevronLeft className="w-4 h-4" />
                  Previous
                </Button>

                <span className="text-sm text-gray-600">
                  Page {currentPage} of {totalPages}
                </span>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => changePage("next")}
                  disabled={currentPage >= totalPages}
                >
                  Next
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>

              {/* Canvas Container */}
              <div className="border border-gray-300 rounded-lg overflow-auto bg-white relative">
                <canvas
                  ref={canvasRef}
                  onMouseDown={handleCanvasMouseDown}
                  onMouseMove={handleCanvasMouseMove}
                  onMouseUp={handleCanvasMouseUp}
                  onMouseLeave={handleCanvasMouseUp}
                  className={`max-w-full h-auto ${editMode === "blur" || editMode === "erase"
                    ? "cursor-none"
                    : editMode === "text"
                      ? "cursor-text"
                      : "cursor-default"
                    }`}
                />

                {/* Hidden canvas for original content */}
                <canvas ref={originalCanvasRef} className="hidden" />

                {/* Loading overlay */}
                {isLoading && (
                  <div className="absolute inset-0 bg-white bg-opacity-70 flex items-center justify-center">
                    <div className="text-center">
                      <div className="inline-block animate-spin h-8 w-8 border-4 border-blue-500 border-t-transparent rounded-full mb-2"></div>
                      <p className="text-blue-600 font-medium">Loading...</p>
                    </div>
                  </div>
                )}

                {/* Text Boxes */}
                {(textBoxes[currentPage] || []).map((textBox) => (
                  <div
                    key={textBox.id}
                    className="absolute"
                    style={{
                      left: textBox.x,
                      top: textBox.y,
                      fontSize: textBox.fontSize,
                      color: textBox.color,
                    }}
                  >
                    {textBox.isEditing ? (
                      <div className="bg-white border border-blue-500 rounded-lg p-2 shadow-lg min-w-[200px]">
                        <Textarea
                          value={textBox.text}
                          onChange={(e) => updateTextBox(textBox.id, { text: e.target.value })}
                          placeholder="Enter your text..."
                          className="mb-2 resize-none"
                          rows={3}
                          autoFocus
                        />
                        <div className="flex justify-end space-x-2">
                          <Button size="sm" variant="outline" onClick={() => deleteTextBox(textBox.id)}>
                            <X className="w-3 h-3" />
                          </Button>
                          <Button size="sm" onClick={() => updateTextBox(textBox.id, { isEditing: false })}>
                            <Check className="w-3 h-3" />
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div
                        className="cursor-move hover:bg-blue-50 hover:bg-opacity-50 p-1 rounded group relative"
                        onMouseDown={(e) => handleTextBoxMouseDown(e, textBox)}
                        onDoubleClick={() => updateTextBox(textBox.id, { isEditing: true })}
                      >
                        <span className="select-none">{textBox.text || "Empty text"}</span>
                        <div className="absolute -top-6 -right-6 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 w-6 p-0"
                            onClick={(e) => {
                              e.stopPropagation()
                              deleteTextBox(textBox.id)
                            }}
                          >
                            <X className="w-3 h-3" />
                          </Button>
                        </div>
                        <Move className="absolute -top-2 -left-2 w-4 h-4 text-blue-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                      </div>
                    )}
                  </div>
                ))}

                {/* Brush Preview */}
                {(editMode === "blur" || editMode === "erase") && (
                  <div
                    className="absolute pointer-events-none border-2 border-blue-500 rounded-full opacity-70 bg-blue-100 bg-opacity-30"
                    style={{
                      width: brushSize,
                      height: brushSize,
                      left: mousePos.x - brushSize / 2,
                      top: mousePos.y - brushSize / 2,
                    }}
                  />
                )}
              </div>

              {/* Instructions */}
              <div className="mt-4 p-3 bg-blue-50 rounded-lg">
                <p className="text-sm text-blue-800">
                  {editMode === "blur" &&
                    "Click and drag to blur areas with the brush. The blur effect is applied in real-time."}
                  {editMode === "erase" && "Click and drag to erase areas with the brush"}
                  {editMode === "text" && "Click anywhere to add a text box, then drag to reposition"}
                  {!editMode && "Select a tool from the left panel to start editing"}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
