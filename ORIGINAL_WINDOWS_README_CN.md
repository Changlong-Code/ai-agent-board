# 原项目 Windows 基础版 M2 开发断点

本包保存原版 React/Express/SQLite 代码与M1/M2修改，不是另做的离线看板。当前为开发检查点，Linux完整门禁通过，Windows1909实机未验收，M2尚未完成。

## 在你的电脑上恢复运行

1. 完整解压到固定目录；本机需要能运行的Node22.12+和npm。
2. 首次运行 `Setup-Original-Board.cmd`，联网安装锁定依赖并构建；失败时保留提示，不自动安装系统编译工具或启动AI。
3. 运行 `Diagnose-Original-Board.cmd` 检查当前环境。
4. 运行 `Start-Original-Board.cmd`；原版页面默认 http://127.0.0.1:8776 ，API为8777，可编辑ORIGINAL_PORTS.json。
5. Ctrl+C正常停止；不按进程名批量结束其他Node程序。

基础版默认禁用全部AI执行，不需要CLI或登录才能创建/编辑/拖动任务。数据库、配置、附件、日志位于 `%LOCALAPPDATA%\AI-Agent-Board\original-basic`（可由ORIGINAL_BOARD_HOME指定），与0.2.x伴随版本分离，不自动导入旧库或浏览器任务。

## 数据保护和恢复

启动已有数据库前先用SQLite backup API生成含已提交WAL内容的快照，成功后才允许迁移。快照在独立目录的backups，日志在logs。无效配置保留原件和时间戳副本并停止启动。

完整备份：正常停止后复制整个original-basic目录。自动数据库快照不包含附件或配置，不替代完整备份。

恢复：确认服务全部停止，先保留当前数据目录副本，再恢复已确认的完整目录备份。若只恢复数据库快照，把快照复制成data/agentboard.db，并将旧-wal/-shm文件一同移入保留副本目录，不与恢复库混用。不要运行中替换数据库。配置需要恢复有效config.json；不自动清空损坏文件。

重复启动或异常关闭遗留original.lock会拒绝启动；确认本程序全部停止后才能手动移除该锁。端口占用请改端口，不结束其他项目。卸载前备份后删除解压目录，不自动删除用户数据。

## 当前证据与下一步

完整gate：86服务合同+3Hermes通过，React/服务构建通过，E2E180通过、4项既有真实Agent测试跳过。独立原版启动器浏览器实测通过。详见windows/original-required-gate.log、original-ui-results.json、ORIGINAL_REVIEW.md。

包内不包含node_modules、Node.exe或用户数据库。包含已生成的JS构建产物作为断点证据；在Windows仍应执行Setup以安装目标平台原生依赖并重新构建。

继续开发入口：WORK_CHECKPOINT.md末尾“原项目M1/M2断点”。先完成目标Windows实机，再推进M3授权隔离与M4真实CLI接入。当前用户已要求保存断点并暂停。
