#!/bin/bash
# MÜLK Spor Kulübü - Tek Tıkla Canlı E-Posta Senkronizasyon Başlatıcı
cd "$(dirname "$0")"
clear
echo "=================================================================="
echo "  MÜLK SPOR KULÜBÜ - CANLI E-POSTA SENKRONİZASYON SERVİSİ"
echo "=================================================================="
echo ""
echo "Bu pencere açık kaldığı sürece panel.html sayfanız canlı olarak"
echo "info@mulksporkulubu.com ve Gmail hesaplarınızı senkronize eder."
echo ""
echo "Durdurmak için bu pencereyi kapatabilir veya Ctrl+C yapabilirsiniz."
echo "------------------------------------------------------------------"
echo ""
python3 mail_sync.py

