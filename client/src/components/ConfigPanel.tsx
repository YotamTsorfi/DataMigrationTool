import React, { useState, useEffect } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import {
  SectionContainer,
  InputContainer,
  Button,
} from "./BatchProcessorStyles";
import SecureButton from "./SecureButton";
import { useAuthProtection } from "./withAuthProtection";
interface ConfigItem {
  ConfigKey: string;
  ConfigValue: string;
  Description: string;
  LastUpdated: string;
  ConfigId: number;
}

const ConfigPanel: React.FC = () => {
  const [configs, setConfigs] = useState<ConfigItem[]>([]);
  const [loading, setLoading] = useState(true);
  const { disabled } = useAuthProtection();

  useEffect(() => {
    fetchConfigs();
  }, []);

  const fetchConfigs = async () => {
    try {
      setLoading(true);
      const response = await axios.get(
        `${process.env.REACT_APP_API_URL}/config`
      );

      // Extract the config array from the response
      const configData = response.data.success
        ? response.data.config
        : response.data;

      // Sort the configurations by ConfigId
      const sortedConfigs = configData.sort(
        (a: ConfigItem, b: ConfigItem) => a.ConfigId - b.ConfigId
      );

      setConfigs(sortedConfigs);
    } catch (error) {
      console.error("Error fetching configuration:", error);
      toast.error("Failed to load configuration");
    } finally {
      setLoading(false);
    }
  };

  const handleConfigChange = (index: number, value: string) => {
    const newConfigs = [...configs];
    newConfigs[index].ConfigValue = value;
    setConfigs(newConfigs);
  };

  const saveConfig = async (config: ConfigItem) => {
    try {
      await axios.put(
        `${process.env.REACT_APP_API_URL}/config/${config.ConfigKey}`,
        {
          value: config.ConfigValue,
        }
      );
      toast.success(`${config.ConfigKey} updated successfully`);
    } catch (error) {
      console.error("Error updating config:", error);
      toast.error(`Failed to update ${config.ConfigKey}`);
    }
  };

  return (
    <SectionContainer
      style={{
        width: "90%",
        maxWidth: "1200px",
        margin: "0 auto",
      }}
    >
      <h2>System Configuration</h2>
      {loading ? (
        <p>Loading configurations...</p>
      ) : (
        <>
          {configs.map((config, index) => (
            <InputContainer
              key={config.ConfigKey}
              style={{ overflow: "hidden" }}
            >
              <div>
                <strong>{config.Description || config.ConfigKey}:</strong>
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  marginTop: "5px",
                  marginBottom: "5px",
                  width: "70%",
                  maxWidth: "100%", // מגביל את הרוחב המקסימלי
                }}
              >
                <input
                  type="text"
                  value={config.ConfigValue}
                  onChange={(e) => handleConfigChange(index, e.target.value)}
                  disabled={disabled}
                  style={{
                    flexGrow: 1,
                    minWidth: 0, // חשוב למניעת גלישה בפלקסבוקס
                    maxWidth: "calc(100% - 80px)", // השארת מקום לכפתור
                  }}
                />
                <SecureButton
                  onClick={() => saveConfig(config)}
                  disabled={disabled}
                  style={{ flexShrink: 0 }} // מונע מהכפתור להתכווץ
                >
                  Save
                </SecureButton>
              </div>
              <small>
                Last updated: {new Date(config.LastUpdated).toLocaleString()}
              </small>
            </InputContainer>
          ))}
        </>
      )}
    </SectionContainer>
  );
};

export default ConfigPanel;
